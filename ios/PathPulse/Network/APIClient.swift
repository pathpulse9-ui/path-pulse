import Foundation

/// URLSession-backed HTTP client — mirrors Android's `network/ApiClient.kt`.
///
/// Cookies (session) persist automatically through `HTTPCookieStorage.shared`,
/// which is what a default `URLSessionConfiguration` uses. That matches the
/// Ktor `HttpCookies` plugin behavior on Android.
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
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    let baseURL: URL

    init(baseURL: URL = Config.apiBaseURL) {
        self.baseURL = baseURL

        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 15
        cfg.timeoutIntervalForResource = 30
        cfg.httpCookieAcceptPolicy = .always
        cfg.httpShouldSetCookies = true
        cfg.httpCookieStorage = HTTPCookieStorage.shared
        self.session = URLSession(configuration: cfg)

        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    // MARK: - Public request surface

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await send(makeRequest(path: path, method: "GET", query: query))
    }

    func post<T: Decodable>(_ path: String, body: Encodable? = nil) async throws -> T {
        try await send(makeRequest(path: path, method: "POST", body: body))
    }

    /// Fire-and-forget POST — used for logout / cleanup where the response body
    /// is irrelevant. Optional JSON body for endpoints that take one.
    @discardableResult
    func postDiscardingBody(_ path: String, body: Encodable? = nil) async throws -> Int {
        let (_, response) = try await session.data(for: makeRequest(path: path, method: "POST", body: body))
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

        let (data, response) = try await session.data(for: req)
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
            (data, response) = try await session.data(for: request)
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
