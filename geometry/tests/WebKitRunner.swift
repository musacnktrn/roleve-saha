// [codex] ureten: codex
import AppKit
import WebKit
import Foundation

final class Receiver: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let result = message.body as? String else { exit(2) }
        print(result)
        guard let data = result.data(using: .utf8),
              let report = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              report["ok"] as? Bool == true else { exit(1) }
        exit(0)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write(Data(error.localizedDescription.utf8))
        exit(2)
    }
}
guard CommandLine.arguments.count == 4,
      let url = URL(string: CommandLine.arguments[1]), url.host == "127.0.0.1",
      let width = Double(CommandLine.arguments[2]), let height = Double(CommandLine.arguments[3]) else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let receiver = Receiver()
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
config.userContentController.add(receiver, name: "done")
let browser = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
browser.navigationDelegate = receiver
let window = NSWindow(contentRect: browser.bounds, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = browser
window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
window.orderBack(nil)
browser.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
    browser.evaluateJavaScript("JSON.stringify({ready:document.readyState,result:document.getElementById('test-result')?.textContent,title:document.querySelector('#dlg-title')?.textContent,location:location.pathname})") { value, error in
        FileHandle.standardError.write(Data(String(describing: value ?? error?.localizedDescription ?? "bekliyor").utf8))
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
    FileHandle.standardError.write(Data("WebKit test zaman aşımı.".utf8))
    exit(2)
}
RunLoop.main.run()
