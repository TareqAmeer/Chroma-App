import UIKit
import UniformTypeIdentifiers

// Chromasmith in the system share sheet (Photos, Files, Safari…). It copies the shared images —
// RAW originals preferred — into the app group folder, then opens the app, which imports whatever
// is waiting there (PhotoPairPlugin.takeShared). If the app group is unavailable (some sideloading
// signers can't provide one) it just opens the app's own Photos picker instead.
class ShareViewController: UIViewController {
    private let groupID = "group.com.tareq.chromasmith"
    private var started = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(white: 0.08, alpha: 1)
        let spinner = UIActivityIndicatorView(style: .large)
        spinner.color = .white
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.startAnimating()
        let label = UILabel()
        label.text = "Opening in Chromasmith…"
        label.textColor = .white
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(spinner)
        view.addSubview(label)
        NSLayoutConstraint.activate([
            spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -16),
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 14)
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if started { return }
        started = true
        process()
    }

    private func bestType(_ p: NSItemProvider) -> String? {
        let ids = p.registeredTypeIdentifiers
        if let raw = ids.first(where: { UTType($0)?.conforms(to: UTType("public.camera-raw-image") ?? .image) == true && $0 != UTType.image.identifier }) { return raw }
        if let img = ids.first(where: { UTType($0)?.conforms(to: .image) == true }) { return img }
        return nil
    }

    private func process() {
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID)?
            .appendingPathComponent("shared", isDirectory: true) else {
            finish("chromasmith://import"); return
        }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let group = DispatchGroup()
        let lock = NSLock()
        var copied = 0
        for p in providers {
            guard let type = bestType(p) else { continue }
            group.enter()
            p.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                defer { group.leave() }
                guard let url = url else { return }
                let tag = String(UUID().uuidString.prefix(8))
                let dest = dir.appendingPathComponent("\(tag)-\(url.lastPathComponent)")
                do {
                    try FileManager.default.copyItem(at: url, to: dest)
                    lock.lock(); copied += 1; lock.unlock()
                } catch {}
            }
        }
        group.notify(queue: .main) { [weak self] in
            self?.finish(copied > 0 ? "chromasmith://shared" : "chromasmith://import")
        }
    }

    private func finish(_ urlString: String) {
        if let url = URL(string: urlString) { openApp(url) }
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    // Extensions can't call UIApplication.shared.open directly; walk the responder chain to the host
    // UIApplication and invoke open(_:options:completionHandler:) (openURL: no longer works on iOS 18).
    private func openApp(_ url: URL) {
        var responder: UIResponder? = self
        let modern = NSSelectorFromString("openURL:options:completionHandler:")
        let legacy = NSSelectorFromString("openURL:")
        while let r = responder {
            if r.responds(to: modern) {
                typealias Fn = @convention(c) (AnyObject, Selector, URL, [UIApplication.OpenExternalURLOptionsKey: Any], ((Bool) -> Void)?) -> Void
                let imp = r.method(for: modern)
                unsafeBitCast(imp, to: Fn.self)(r, modern, url, [:], nil)
                return
            }
            if r.responds(to: legacy) { _ = r.perform(legacy, with: url); return }
            responder = r.next
        }
    }
}
