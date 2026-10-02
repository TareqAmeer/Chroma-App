import Foundation
import Capacitor
import Photos
import PhotosUI
import UniformTypeIdentifiers

// Photo picker that returns EVERY original stored for each picked photo: a RAW+JPEG capture is
// one Photos asset with a .photo (JPEG/HEIC) and an .alternatePhoto (RAW) resource, and the web
// file picker only ever hands over the first. Files are copied to the app's temp folder and
// returned as paths the web view reads through Capacitor.convertFileSrc.
@objc(PhotoPairPlugin)
public class PhotoPairPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "PhotoPairPlugin"
    public let jsName = "PhotoPair"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?

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
            for (j, r) in picks.enumerated() {
                let url = dir.appendingPathComponent("\(i)-\(j)-\(r.originalFilename)")
                group.enter()
                PHAssetResourceManager.default().writeData(for: r, toFile: url, options: opts) { err in
                    lock.lock()
                    if err == nil {
                        out.append(["path": url.path, "name": r.originalFilename, "uti": r.uniformTypeIdentifier,
                                    "raw": r.type == .alternatePhoto, "order": i * 10 + j])
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
