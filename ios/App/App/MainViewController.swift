import UIKit
import Capacitor

// Registers the app's own native plugins (Capacitor only auto-registers npm plugins).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PhotoPairPlugin())
    }
}
