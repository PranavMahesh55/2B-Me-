import Foundation
import GrantCore

/// §2: POST 127.0.0.1:8787/grant
///
///   grant-signer serve [--port N] [--role production|test]
///                      [--origin O ...] [--secret-file PATH] [--debug]
func runServe(_ args: [String]) {
    var port: UInt16 = 8787
    var role = KeyRole.production
    var origins = ["app://2bme-overlay"]
    var secretFile: String?
    var debug = false

    var arguments = args
    while let argument = arguments.first {
        arguments.removeFirst()
        switch argument {
        case "--port": port = UInt16(arguments.removeFirst()) ?? 8787
        case "--role":
            role = arguments.removeFirst() == "test" ? .test : .production
        case "--origin":
            // Replaces the default on first use, then appends.
            if origins == ["app://2bme-overlay"] { origins = [] }
            origins.append(arguments.removeFirst())
        case "--secret-file": secretFile = arguments.removeFirst()
        case "--debug": debug = true
        default:
            FileHandle.standardError.write(Data("unknown argument \(argument)\n".utf8))
            exit(2)
        }
    }

    func log(_ line: String) {
        FileHandle.standardError.write(Data("[signer] \(line)\n".utf8))
    }

    let keys = EnclaveKeyManager(role: role)
    do {
        // §5: generate once on first run, look it up on every start.
        try keys.loadOrCreate()
        log("issuer \(try keys.issuer()) (tag \(role.tag))")
    } catch {
        log("could not open the signing key: \(error)")
        exit(1)
    }

    // The Origin header is set by the caller, so on loopback it proves nothing by
    // itself; what it does buy is that a browser cannot forge one, which is the
    // attack §1 names. The shared secret is what actually authenticates: the
    // Electron main process can read a 0600 file, a web page cannot.
    var launchSecret: String?
    if let secretFile {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let secret = Base64URL.encode(bytes)
        let url = URL(fileURLWithPath: secretFile)
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(secret.utf8).write(to: url, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            launchSecret = secret
            log("launch secret written to \(secretFile) (0600)")
        } catch {
            log("could not write the launch secret: \(error)")
            exit(1)
        }
    } else {
        log("no --secret-file: the Origin allowlist is the only caller check")
    }

    let service = GrantService(
        keys: keys,
        // §9 #4 can be exercised without a fingerprint by serving the test key.
        requirePresence: role.requiresBiometry,
        log: { if debug { log($0) } }
    )

    let server = LoopbackHTTPServer(port: port) { request in
        // Transport checks first: nothing is parsed and no prompt is raised for a
        // caller that is not the overlay.
        guard let origin = request.headers["origin"], origins.contains(origin) else {
            log("origin rejected: \(request.headers["origin"] ?? "<absent>")")
            // Deliberately not a GrantErrorCode: a rejected origin is not the UI
            // by construction, so a grant code would only say how far it got.
            return HTTPResponse.json(403, "{\"error\":\"origin_rejected\"}")
        }
        if let launchSecret, request.headers["x-2bme-launch-secret"] != launchSecret {
            return HTTPResponse.json(403, "{\"error\":\"origin_rejected\"}")
        }
        guard request.method == "POST", request.path.hasPrefix("/grant") else {
            return HTTPResponse.json(404, "{\"error\":\"not_found\"}")
        }

        do {
            let parsed = try GrantRequest.parse(request.body)
            let (claims, signature) = try service.grant(parsed)
            return HTTPResponse.json(200, try GrantService.tokenJSON(claims: claims, signature: signature))
        } catch let error as SignerError {
            log("\(error.code.rawValue): \(error.message)")
            return HTTPResponse.error(error.code, error.message)
        } catch {
            // §10: every error path returns an enumerated code. A 500 with a
            // stack trace is a bug.
            log("unexpected: \(error)")
            return HTTPResponse.error(.malformedRequest, nil)
        }
    }

    do {
        try server.start()
    } catch {
        log("could not bind 127.0.0.1:\(port): \(error)")
        exit(1)
    }
    log("listening on 127.0.0.1:\(port)")
    log("origins \(origins.joined(separator: ", "))")
    dispatchMain()
}
