import Foundation
import Security

/// URLSession-backed HTTP client — mirrors Android's `network/ApiClient.kt`.
///
/// The session cookie lives in an in-memory cookie store and is mirrored to
/// the Keychain after every response, so it survives relaunches without ever
/// touching disk in plaintext.
///
/// The backend returns errors as `{ "error", "message", "requestId" }`, which
/// we decode into `APIErrorPayload` and rethrow as `APIError`.
enum APIError: Error, LocalizedError {
    case http(status: Int, payload: APIErrorPayload?)
    case transport(URLError)
    case decoding(DecodingError)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .http(let status, let payload):
            return payload?.message ?? "HTTP \(status)"
        case .transport(let err):
            return err.localizedDescription
        case .decoding:
            return "Received unexpected response from the server."
        case .invalidResponse:
            return "Received a non-HTTP response."
        }
    }
}

final class APIClient: @unchecked Sendable {
    /// URLSession/JSONCoder are effectively thread-safe for the concurrent-read
    /// usage this client makes of them, so `nonisolated(unsafe)` is the intended
    /// escape hatch for a Swift-6 strict-concurrency shared singleton.
    nonisolated(unsafe) static let shared = APIClient()

    private let session: URLSession
    private let cookies: HTTPCookieStorage
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    let baseURL: URL

    init(baseURL: URL = Config.apiBaseURL) {
        self.baseURL = baseURL

        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 30
        cfg.httpCookieAcceptPolicy = .always
        cfg.httpShouldSetCookies = true
        let store = cfg.httpCookieStorage ?? HTTPCookieStorage()
        cfg.httpCookieStorage = store
        self.cookies = store
        self.session = URLSession(configuration: cfg)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-PathPulseResetSession") { SessionKeychain.clear() }
        #endif
        if let saved = SessionKeychain.load() ?? SessionKeychain.migrateFromSharedStorage(for: baseURL) {
            store.setCookie(saved)
        }

        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Public request surface

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await send(makeRequest(path: path, method: "GET", query: query))
    }

    /// GET where a `204 No Content` is a valid, non-error outcome that should
    /// surface as `nil` instead of a decoding error. Used by endpoints like
    /// `/v1/carret/resume` which return 204 when the driver has no state saved.
    func getOptional<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T? {
        let request = try makeRequest(path: path, method: "GET", query: query)
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(request)
        } catch let err as URLError {
            throw APIError.transport(err)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 204 { return nil }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.http(status: http.statusCode, payload: payload)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch let err as DecodingError {
            throw APIError.decoding(err)
        }
    }

    func post<T: Decodable>(_ path: String, body: Encodable? = nil) async throws -> T {
        try await send(makeRequest(path: path, method: "POST", body: body))
    }

    func post<T: Decodable>(_ path: String, body: Encodable, idempotencyKey: String) async throws -> T {
        var request = try makeRequest(path: path, method: "POST", body: body)
        request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
        return try await send(request)
    }

    /// Fire-and-forget POST — used for logout / cleanup where the response body
    /// is irrelevant. Optional JSON body for endpoints that take one.
    @discardableResult
    func postDiscardingBody(_ path: String, body: Encodable? = nil) async throws -> Int {
        let (_, response) = try await perform(makeRequest(path: path, method: "POST", body: body))
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return http.statusCode
    }

    @discardableResult
    func deleteDiscardingBody(_ path: String) async throws -> Int {
        let (_, response) = try await perform(makeRequest(path: path, method: "DELETE"))
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        return http.statusCode
    }

    /// Multipart form-data POST — used for Carret KYC file uploads (PAT-79).
    /// The `fields` are plain form fields, `fileField` is the name of the file
    /// part (Carret expects `doc_front` / `doc_back`), and `fileURL` is a local
    /// file the user picked. Cookie session is sent automatically.
    func uploadMultipart(
        _ path: String,
        fields: [String: String],
        fileField: String,
        fileURL: URL,
    ) async throws {
        let boundary = "----PathPulseBoundary\(UUID().uuidString)"
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        let filename = fileURL.lastPathComponent
        let mime = mimeType(for: fileURL)

        for (name, value) in fields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        // File part.
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fileField)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
        body.append(try Data(contentsOf: fileURL))
        body.append("\r\n".data(using: .utf8)!)
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        req.httpBody = body

        let (data, response) = try await perform(req)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.http(status: http.statusCode, payload: payload)
        }
    }

    private func mimeType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "xml": return "application/xml"
        case "zip": return "application/zip"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "pdf": return "application/pdf"
        default: return "application/octet-stream"
        }
    }

    // MARK: - Internals

    private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
        let result = try await session.data(for: request)
        let current = cookies.cookies(for: baseURL)?.first { $0.name == SessionKeychain.cookieName }
        if let current { SessionKeychain.save(current) } else { SessionKeychain.clear() }
        return result
    }

    private func makeRequest(
        path: String,
        method: String,
        query: [String: String] = [:],
        body: Encodable? = nil
    ) throws -> URLRequest {
        var comps = URLComponents(
            url: baseURL.appendingPathComponent(path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(AnyEncodable(body))
        }
        return req
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(request)
        } catch let err as URLError {
            throw APIError.transport(err)
        }

        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let payload = try? decoder.decode(APIErrorPayload.self, from: data)
            throw APIError.http(status: http.statusCode, payload: payload)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch let err as DecodingError {
            throw APIError.decoding(err)
        }
    }
}

/// Type-erased wrapper so `Encodable` values can be encoded through a generic
/// `JSONEncoder` call site.
private struct AnyEncodable: Encodable {
    let base: Encodable
    init(_ base: Encodable) { self.base = base }
    func encode(to encoder: Encoder) throws { try base.encode(to: encoder) }
}

enum SessionKeychain {
    static let cookieName = "pathpulse_session"
    private static let service = "ai.pathpulse.driver.session"

    private struct Stored: Codable {
        let name: String
        let value: String
        let domain: String
        let path: String
        let expires: Date?
        let secure: Bool
    }

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: cookieName]
    }

    static func load() -> HTTPCookie? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let stored = try? JSONDecoder().decode(Stored.self, from: data) else { return nil }
        if let expires = stored.expires, expires <= Date() {
            clear()
            return nil
        }
        var props: [HTTPCookiePropertyKey: Any] = [
            .name: stored.name, .value: stored.value, .domain: stored.domain, .path: stored.path,
        ]
        if let expires = stored.expires { props[.expires] = expires }
        if stored.secure { props[.secure] = "TRUE" }
        return HTTPCookie(properties: props)
    }

    static func save(_ cookie: HTTPCookie) {
        let stored = Stored(
            name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path,
            expires: cookie.expiresDate, secure: cookie.isSecure
        )
        guard let data = try? JSONEncoder().encode(stored) else { return }
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        if SecItemUpdate(query as CFDictionary, attrs as CFDictionary) == errSecItemNotFound {
            SecItemAdd(query.merging(attrs) { $1 } as CFDictionary, nil)
        }
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }

    static func migrateFromSharedStorage(for url: URL) -> HTTPCookie? {
        let shared = HTTPCookieStorage.shared
        guard let legacy = shared.cookies(for: url)?.first(where: { $0.name == cookieName }) else { return nil }
        shared.deleteCookie(legacy)
        save(legacy)
        return legacy
    }
}
