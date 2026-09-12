# Google Sign-In — the app also needs to be registered

The `GOOGLE_CLIENT_ID` env var only tells the backend what audience to
verify. For the **apps themselves** to be handed a Google ID token,
each one must be registered in your Firebase project. Right now
neither iOS nor Android is registered, so the OS refuses the sign-in
before the token ever reaches the backend.

Two small things left, one per platform.

---

## 1. Android — register the debug app

Open **Firebase Console → Project settings → General → Your apps → Add app → Android** (or if an Android app already exists in your project, add these values as a **new SHA fingerprint** on it).

**Package name:**
```
com.pathpulse.driver
```

**Debug SHA-1** (this is my local dev machine's debug keystore — Aditya):
```
58:D9:DD:6A:8E:82:7E:C6:D4:A3:25:AD:F4:11:25:A7:92:B8:2D:DD
```

**Debug SHA-256** (only needed if the console asks):
```
60:7D:E9:EF:AF:5F:FB:DF:60:7B:23:82:9D:F5:54:84:13:9C:9D:99:79:35:B8:A8:7B:4E:7E:F7:4B:9D:BD:08
```

That's it — no config file to send back to me, no code change on my
side. Once registered, "Continue with Google" on the Android app
starts returning tokens with the audience already set to the Web
client ID we're verifying against, and the backend's
`/v1/auth/google/verify` accepts them.

*Note: this is the DEBUG signing cert only, which lets any developer
build sign in. Before we ship a release APK to Play Store, we'll add
the release keystore's SHA-1 too — one more line to add, same place.*

---

## 2. iOS — create an iOS OAuth Client ID

The iOS Google button is currently **disabled in code** because there's
no iOS OAuth client id yet. To enable it:

**Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth Client ID → iOS**

**Bundle ID:**
```
ai.pathpulse.driver
```

Copy the client ID Google generates (looks like
`123-abc.apps.googleusercontent.com`) and send it back to me. I'll
paste it into `ios/PathPulse/Config.swift` and add the reversed URL
scheme to Info.plist so the OAuth callback opens the app.

*If you'd rather not enable native iOS Google sign-in right now,
that's fine — iOS can just use Guest for a while longer. Android is
the priority.*

---

## Nothing else needed

- ✅ Backend `GOOGLE_CLIENT_ID` env var — you already set this
- ✅ Web `NEXT_PUBLIC_GOOGLE_CLIENT_ID` env var — you already set this
- ✅ Backend redeployed
- ✅ Web redeployed with the new wizard
- ❌ Android app entry in Firebase — needs the values above
- ❌ iOS OAuth client id — needs the ID sent back to me

Once (1) is done, Android Google Sign-In works end-to-end.
Once (2) is done + I paste the ID, iOS Google Sign-In works too.
