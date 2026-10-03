import Foundation
import Capacitor
import Photos
import PhotosUI
import UniformTypeIdentifiers
import CoreImage

// Photo picker that returns EVERY original stored for each picked photo: a RAW+JPEG capture is
// one Photos asset with a .photo (JPEG/HEIC) and an .alternatePhoto (RAW) resource, and the web
// file picker only ever hands over the first. Files are copied to the app's temp folder and
// returned as paths the web view reads through Capacitor.convertFileSrc.
@objc(PhotoPairPlugin)
public class PhotoPairPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "PhotoPairPlugin"
    public let jsName = "PhotoPair"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeShared", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?

    // Apple ProRAW / DNG at full size (48MP) can't be decoded by the web view's WASM RAW decoder: it holds the
    // whole frame several times over and iOS kills the page ("Opening…" then the gallery refreshes). Develop it
    // natively instead — Core Image's RAW pipeline renders the same image Photos shows — and hand the web side a
    // full-resolution sRGB JPEG to edit; the DNG itself is still kept as the original. nil = fall back to WASM.
    static func developDNG(_ src: URL) -> URL? {
        guard #available(iOS 15.0, *), let raw = CIRAWFilter(imageURL: src), let img = raw.outputImage,
              let cs = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let out = src.deletingPathExtension().appendingPathExtension("developed.jpg")
        let ctx = CIContext(options: [.cacheIntermediates: false])
        do {
            try ctx.writeJPEGRepresentation(of: img, to: out, colorSpace: cs,
                options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.95])
            return out
        } catch { return nil }
    }
    static func isDNG(name: String, uti: String?) -> Bool { name.lowercased().hasSuffix(".dng") || uti == "com.adobe.raw-image" }

    @objc func pick(_ call: CAPPluginCall) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            DispatchQueue.main.async {
                guard status == .authorized || status == .limited else {
                    call.reject("Photo library access was not allowed."); return
                }
                var config = PHPickerConfiguration(photoLibrary: .shared())
                config.selectionLimit = 0
                config.filter = .images
                config.preferredAssetRepresentationMode = .current
                let picker = PHPickerViewController(configuration: config)
                picker.delegate = self
                self.pending = call
                self.bridge?.viewController?.present(picker, animated: true)
            }
        }
    }

    // Photos handed over by the Share Extension (ShareExt) through the app group folder: move them to
    // temp (so the group folder is emptied) and return them like picked photos. Empty if none/no group.
    @objc func takeShared(_ call: CAPPluginCall) {
        let fm = FileManager.default
        guard let src = fm.containerURL(forSecurityApplicationGroupIdentifier: "group.com.tareq.chromasmith")?
            .appendingPathComponent("shared", isDirectory: true),
              let names = try? fm.contentsOfDirectory(atPath: src.path), !names.isEmpty else {
            call.resolve(["files": []]); return
        }
        let dir = fm.temporaryDirectory.appendingPathComponent("shared-in", isDirectory: true)
        try? fm.removeItem(at: dir)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        var out: [[String: Any]] = []
        for n in names.sorted() {
            let from = src.appendingPathComponent(n)
            let to = dir.appendingPathComponent(n)
            do { try fm.moveItem(at: from, to: to) } catch { continue }
            // Drop the "xxxxxxxx-" collision prefix the extension added.
            let clean = n.count > 9 && n[n.index(n.startIndex, offsetBy: 8)] == "-" ? String(n.dropFirst(9)) : n
            var entry: [String: Any] = ["path": to.path, "name": clean]
            if PhotoPairPlugin.isDNG(name: clean, uti: nil), let dev = PhotoPairPlugin.developDNG(to) { entry["dev"] = dev.path }
            out.append(entry)
        }
        call.resolve(["files": out])
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pending else { return }
        pending = nil
        let ids = results.compactMap { $0.assetIdentifier }
        if ids.isEmpty { call.resolve(["files": []]); return }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var ordered: [PHAsset] = []
        assets.enumerateObjects { a, _, _ in ordered.append(a) }
        // Keep the user's pick order.
        ordered.sort { (ids.firstIndex(of: $0.localIdentifier) ?? 0) < (ids.firstIndex(of: $1.localIdentifier) ?? 0) }
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("photopair", isDirectory: true)
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let group = DispatchGroup()
        let lock = NSLock()
        var out: [[String: Any]] = []
        let opts = PHAssetResourceRequestOptions()
        opts.isNetworkAccessAllowed = true
        for (i, asset) in ordered.enumerated() {
            let res = PHAssetResource.assetResources(for: asset)
            let wanted = res.filter { $0.type == .photo || $0.type == .alternatePhoto || $0.type == .fullSizePhoto }
            // When edited in Photos there is a fullSizePhoto (the edit) as well as the .photo original: keep originals only.
            let picks = wanted.contains { $0.type == .photo } ? wanted.filter { $0.type != .fullSizePhoto } : wanted
            // Apple ProRAW / any DNG original: bring in the DNG ITSELF, not the HEIC/JPEG rendition Photos
            // stores beside it. (Third-party RAW+JPEG pairs like RW2+JPEG still arrive as both files.)
            let dngs = picks.filter { $0.uniformTypeIdentifier == "com.adobe.raw-image" || $0.originalFilename.lowercased().hasSuffix(".dng") }
            let chosen = dngs.isEmpty ? picks : dngs
            for (j, r) in chosen.enumerated() {
                let url = dir.appendingPathComponent("\(i)-\(j)-\(r.originalFilename)")
                group.enter()
                PHAssetResourceManager.default().writeData(for: r, toFile: url, options: opts) { err in
                    lock.lock()
                    if err == nil {
                        var entry: [String: Any] = ["path": url.path, "name": r.originalFilename, "uti": r.uniformTypeIdentifier,
                                    "raw": r.type == .alternatePhoto || r.uniformTypeIdentifier == "com.adobe.raw-image", "order": i * 10 + j]
                        if PhotoPairPlugin.isDNG(name: r.originalFilename, uti: r.uniformTypeIdentifier), let dev = PhotoPairPlugin.developDNG(url) { entry["dev"] = dev.path }
                        out.append(entry)
                    }
                    lock.unlock()
                    group.leave()
                }
            }
        }
        group.notify(queue: .main) {
            let sorted = out.sorted { ($0["order"] as? Int ?? 0) < ($1["order"] as? Int ?? 0) }
            call.resolve(["files": sorted])
        }
    }
}
