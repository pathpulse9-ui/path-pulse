import Foundation

/// Translates raw `APIError` / `URLError` values into copy a driver will
/// understand. Never surfaces stack traces, URLs, HTTP status codes, or
/// JSON snippets in the final message — those still go to the device log
/// so we can debug via console.
public struct UserErrors {
    public static func message(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .http(let status, let payload):
                return httpMessage(status: status, payload: payload)
            case .transport:
                return "Please check your internet connection and try again."
            case .decoding, .invalidResponse:
                return "We couldn't read the reply. Please try again in a moment."
            }
        }
        if let url = error as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost, .dnsLookupFailed:
                return "Please check your internet connection and try again."
            default:
                return "Something went wrong. Please try again."
            }
        }
        return "Something went wrong. Please try again."
    }

    private static func httpMessage(status: Int, payload: APIErrorPayload?) -> String {
        // Some codes we know how to soften without leaking internals.
        switch status {
        case 401:
            return "Please sign in again to continue."
        case 403:
            // Carret VPN/proxy block bubbles up as 500 wrapping 403; this
            // catches the direct-403 case too.
            return "Our payments partner is briefly unavailable. Please try again in a few minutes."
        case 404:
            // "Not found" during KYC usually means the session expired.
            return "This step is no longer available. Please start over."
        case 409:
            return "That was already submitted. Refresh and try again if you don't see it."
        case 422:
            // Server sends a helpful message for validation-type errors — but strip anything
            // that looks like a stack trace or a raw payload leak.
            let msg = payload?.message ?? ""
            return firstUsableSentence(msg) ?? "Some of the details couldn't be accepted. Please review and try again."
        case 429:
            return "You've reached today's withdraw limit. Available again tomorrow."
        case 503:
            // Backend uses 503 for upstream partner failures — the message is
            // already driver-safe ("Payments partner is briefly unavailable…").
            if let msg = firstUsableSentence(payload?.message ?? "") { return msg }
            return "Our payments partner is briefly unavailable. Please try again in a few minutes."
        case 500...599:
            // Some server-thrown errors carry a helpful, user-safe message.
            if let msg = firstUsableSentence(payload?.message ?? "") { return msg }
            return "Something's off on our side. Please try again in a moment."
        default:
            return "Something went wrong. Please try again."
        }
    }

    /// Returns a message only when it looks user-safe (no braces, no URLs,
    /// no `undefined`, no stack-trace-y noise). Otherwise nil.
    private static func firstUsableSentence(_ raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !trimmed.contains("{"),
              !trimmed.contains("://"),
              !trimmed.lowercased().contains("stack"),
              !trimmed.lowercased().contains("undefined") else { return nil }
        // Cap it — long server messages read as failure noise.
        if trimmed.count > 140 { return String(trimmed.prefix(140)) + "…" }
        return trimmed
    }
}
