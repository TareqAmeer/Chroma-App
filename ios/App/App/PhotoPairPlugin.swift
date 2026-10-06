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
        CAPPluginMethod(name: "takeShared", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readAdjustment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveAdjustment", returnType: CAPPluginReturnPromise)
    ]
    private var pending: CAPPluginCall?
    private static let adjustmentFormatIdentifier = "com.tareq.chromasmith.photos-recipe"
    private static let adjustmentFormatVersion = "1"

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

    // Read only this app's versioned edit recipe from a Photos adjustment. Returning foreign or
    // future-version data as if it were a Chromasmith recipe would silently corrupt an edit.
    @objc func readAdjustment(_ call: CAPPluginCall) {
        guard let identifier = call.getString("assetIdentifier"), !identifier.isEmpty else {
            call.reject("A Photos asset identifier is required."); return
        }
        withReadablePhotoAccess(call) {
            let fetched = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
            guard let asset = fetched.firstObject, asset.mediaType == .image,
                  !asset.mediaSubtypes.contains(.photoLive) else {
                call.reject("This Photos asset is missing or is not a supported still image."); return
            }
            let options = PHContentEditingInputRequestOptions()
            options.isNetworkAccessAllowed = true
            options.canHandleAdjustmentData = { adjustment in
                adjustment.formatIdentifier == Self.adjustmentFormatIdentifier &&
                adjustment.formatVersion == Self.adjustmentFormatVersion
            }
            asset.requestContentEditingInput(with: options) { input, _ in
                guard let data = input?.adjustmentData,
                      data.formatIdentifier == Self.adjustmentFormatIdentifier,
                      data.formatVersion == Self.adjustmentFormatVersion,
                      let recipe = String(data: data.data, encoding: .utf8) else {
                    call.resolve(["assetIdentifier": identifier, "recipeJSON": NSNull()]); return
                }
                call.resolve(["assetIdentifier": identifier, "recipeJSON": recipe])
            }
        }
    }

    // Save one already-rendered still-image export as a non-destructive Photos adjustment.
    // The original Photos resource is never replaced; adjustmentData keeps the editable recipe.
    @objc func saveAdjustment(_ call: CAPPluginCall) {
        guard let identifier = call.getString("assetIdentifier"), !identifier.isEmpty,
              let renderedPath = call.getString("renderedPath"),
              let recipeJSON = call.getString("recipeJSON"),
              let recipeData = recipeJSON.data(using: .utf8), recipeData.count <= 16 * 1024 * 1024,
              (try? JSONSerialization.jsonObject(with: recipeData)) is [String: Any] else {
            call.reject("A Photos asset, rendered image, and valid recipe are required."); return
        }
        let renderedURL: URL
        if let url = URL(string: renderedPath), url.isFileURL {
            renderedURL = url
        } else {
            renderedURL = URL(fileURLWithPath: renderedPath)
        }
        guard FileManager.default.fileExists(atPath: renderedURL.path),
              let fileType = UTType(filenameExtension: renderedURL.pathExtension.lowercased()) else {
            call.reject("The rendered still image is unavailable or has an unsupported file type."); return
        }
        withReadablePhotoAccess(call) {
            let fetched = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
            guard let asset = fetched.firstObject, asset.mediaType == .image,
                  !asset.mediaSubtypes.contains(.photoLive), asset.canPerform(.content) else {
                call.reject("This Photos asset cannot accept a still-image edit."); return
            }
            let resources = PHAssetResource.assetResources(for: asset)
            let hasRawResource = resources.contains { resource in
                resource.type == .alternatePhoto || resource.uniformTypeIdentifier == "com.adobe.raw-image" ||
                resource.uniformTypeIdentifier == "public.camera-raw"
            }
            guard !hasRawResource else {
                call.reject("Saving a rendered edit to RAW or RAW+JPEG Photos assets is not supported yet."); return
            }
            let options = PHContentEditingInputRequestOptions()
            options.isNetworkAccessAllowed = true
            options.canHandleAdjustmentData = { adjustment in
                adjustment.formatIdentifier == Self.adjustmentFormatIdentifier &&
                adjustment.formatVersion == Self.adjustmentFormatVersion
            }
            asset.requestContentEditingInput(with: options) { input, _ in
                guard let input = input else {
                    call.reject("Photos could not provide editing input for this asset."); return
                }
                let output = PHContentEditingOutput(contentEditingInput: input)
                guard output.supportedRenderedContentTypes.contains(fileType) else {
                    call.reject("Photos does not support the rendered export format for this asset."); return
                }
                do {
                    let destination = try output.renderedContentURL(for: fileType)
                    try FileManager.default.copyItem(at: renderedURL, to: destination)
                    output.adjustmentData = PHAdjustmentData(
                        formatIdentifier: Self.adjustmentFormatIdentifier,
                        formatVersion: Self.adjustmentFormatVersion,
                        data: recipeData
                    )
                } catch {
                    call.reject("Could not prepare the non-destructive Photos edit: \(error.localizedDescription)"); return
                }
                PHPhotoLibrary.shared().performChanges({
                    PHAssetChangeRequest(for: asset).contentEditingOutput = output
                }) { saved, error in
                    if let error = error {
                        call.reject("Photos could not save the edit: \(error.localizedDescription)"); return
                    }
                    guard saved else { call.reject("Photos did not save the edit."); return }
                    call.resolve(["assetIdentifier": identifier, "status": "updated-source"])
                }
            }
        }
    }

    private func withReadablePhotoAccess(_ call: CAPPluginCall, action: @escaping () -> Void) {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            DispatchQueue.main.async {
                guard status == .authorized || status == .limited else {
                    call.reject("Photos access is required. Allow access in Settings, then try again."); return
                }
                action()
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
                                    "photosAssetIdentifier": asset.localIdentifier,
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
