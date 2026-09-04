import Foundation

/// Auth-scoped API calls. Mirrors Android's `AuthRepository`.
struct AuthRepository: Sendable {
    let client: APIClient

    init(client: APIClient = .shared) { self.client = client }

    /// GET /v1/auth/me — returns the current session user, or nil when
    /// unauthenticated (the backend still 200s with `{ "user": null }`).
    func me() async throws -> SessionUser? {
        let response: AuthMeResponse = try await client.get("v1/auth/me")
        return response.user
    }

    /// POST /v1/auth/google/verify — exchange a Google ID token for a session
    /// cookie + managed wallet.
    func verifyGoogleIdToken(_ idToken: String) async throws -> GoogleVerifyResponse {
        try await client.post(
            "v1/auth/google/verify",
            body: GoogleVerifyRequest(idToken: idToken)
        )
    }

    /// POST /v1/auth/guest — open a read-only guest session.
    func continueAsGuest() async throws -> GuestSessionResponse {
        try await client.post("v1/auth/guest")
    }

    /// POST /v1/auth/logout — server-side session invalidation. Silently
    /// swallows failures because the client-side cleanup (cookie clear) still
    /// happens at the call site regardless.
    func logout() async {
        _ = try? await client.postDiscardingBody("v1/auth/logout")
    }
}
