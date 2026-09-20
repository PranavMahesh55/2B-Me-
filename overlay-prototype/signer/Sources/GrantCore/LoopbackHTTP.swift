import Foundation
import Network

public struct HTTPRequest {
    public let method: String
    public let path: String
    /// Lowercased keys.
    public let headers: [String: String]
    public let body: Data
}

public struct HTTPResponse {
    public let status: Int
    public let body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }

    public static func json(_ status: Int, _ raw: String) -> HTTPResponse {
        HTTPResponse(status: status, body: Data(raw.utf8))
    }

    public static func error(_ code: SignerErrorCode, _ message: String?) -> HTTPResponse {
        // §2: 4xx is { "error": "<GrantErrorCode>", "message": "optional human text" }
        let escaped = (message ?? "").replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        let body = message == nil
            ? "{\"error\":\"\(code.rawValue)\"}"
            : "{\"error\":\"\(code.rawValue)\",\"message\":\"\(escaped)\"}"
        return .json(Self.status(for: code), body)
    }

    static func status(for code: SignerErrorCode) -> Int {
        switch code {
        case .malformedRequest, .unknownOperation: return 400
        case .presenceCancelled, .presenceFailed: return 401
        case .biometryChanged: return 409
        case .keyMissing: return 503
        }
    }

    func serialize() -> Data {
        let reason = status == 200 ? "OK" : "Error"
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        head += "content-type: application/json\r\n"
        head += "content-length: \(body.count)\r\n"
        head += "cache-control: no-store\r\n"
        // No Access-Control-Allow-Origin, ever: the caller is the Electron main
        // process over plain HTTP, not a browser document, and echoing one would
        // hand a rejected caller information.
        head += "connection: close\r\n\r\n"
        return Data(head.utf8) + body
    }
}

/// A minimal HTTP/1.1 listener bound explicitly to loopback.
///
/// §1: "Both bind loopback explicitly. Never 0.0.0.0." Network.framework says
/// that precisely through requiredLocalEndpoint, and it needs no dependency --
/// which matters for a process whose whole point is a small trusted surface.
public final class LoopbackHTTPServer {
    private let port: UInt16
    private let handler: (HTTPRequest) -> HTTPResponse
    private let queue = DispatchQueue(label: "local.intent.signer.http")
    /// Grants run one at a time, so two Touch ID prompts can never race.
    private let grants = DispatchQueue(label: "local.intent.signer.grants")
    private var listener: NWListener?
    private let maxHeaderBytes = 8 * 1024
    private let maxBodyBytes = 64 * 1024

    public init(port: UInt16, handler: @escaping (HTTPRequest) -> HTTPResponse) {
        self.port = port
        self.handler = handler
    }

    public func start() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
        parameters.allowLocalEndpointReuse = true

        let listener = try NWListener(using: parameters)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    public func stop() {
        listener?.cancel()
        listener = nil
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] chunk, _, complete, error in
            guard let self else { return }
            if error != nil { connection.cancel(); return }

            var accumulated = buffer
            if let chunk { accumulated.append(chunk) }

            guard let headerEnd = Self.findHeaderEnd(accumulated) else {
                if accumulated.count > self.maxHeaderBytes || complete {
                    self.respond(connection, HTTPResponse.error(.malformedRequest, "headers too large or truncated"))
                } else {
                    self.receive(connection, buffer: accumulated)
                }
                return
            }

            guard let (method, path, headers) = Self.parseHead(accumulated.prefix(upTo: headerEnd)) else {
                self.respond(connection, HTTPResponse.error(.malformedRequest, "could not parse the request head"))
                return
            }
            if headers["transfer-encoding"] != nil {
                self.respond(connection, HTTPResponse.error(.malformedRequest, "chunked bodies are not accepted"))
                return
            }

            let declared = Int(headers["content-length"] ?? "0") ?? 0
            if declared > self.maxBodyBytes {
                self.respond(connection, HTTPResponse.error(.malformedRequest, "body too large"))
                return
            }
            let bodyStart = headerEnd + 4
            let available = accumulated.count - bodyStart
            if available < declared {
                if complete {
                    self.respond(connection, HTTPResponse.error(.malformedRequest, "body shorter than content-length"))
                } else {
                    self.receive(connection, buffer: accumulated)
                }
                return
            }

            let body = accumulated.subdata(in: bodyStart ..< (bodyStart + declared))
            let request = HTTPRequest(method: method, path: path, headers: headers, body: body)
            // Serialized: one grant, one prompt, at a time.
            self.grants.async {
                let response = self.handler(request)
                self.respond(connection, response)
            }
        }
    }

    private func respond(_ connection: NWConnection, _ response: HTTPResponse) {
        connection.send(content: response.serialize(), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    static func findHeaderEnd(_ data: Data) -> Int? {
        let marker = Data("\r\n\r\n".utf8)
        guard data.count >= marker.count else { return nil }
        for index in 0 ... (data.count - marker.count) where data.subdata(in: index ..< index + marker.count) == marker {
            return index
        }
        return nil
    }

    static func parseHead(_ data: Data) -> (String, String, [String: String])? {
        let text = String(decoding: data, as: UTF8.self)
        var lines = text.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return nil }
        let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true)
        guard requestLine.count >= 2 else { return nil }

        var headers: [String: String] = [:]
        for line in lines where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[line.startIndex ..< colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }
        return (String(requestLine[0]).uppercased(), String(requestLine[1]), headers)
    }
}
