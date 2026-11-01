// Safari 分享扩展（00 §3.13 J3）：只显示网址和标题，"导入"或"稍后读"；进书架前不抓取正文。
// 选好后写进 App Group 的 share-inbox/<时间>.json，主应用打开 / 回到前台时由壳的 share_take_pending 取走导入（app_group.rs）。
// 由 ../add-targets.py 加进 xcodegen 工程；CI 的 ios-smoke 在 iPhone 模拟器里验证它被系统登记、经 App Group 和主应用交换数据。真机没跑过。
import SwiftUI
import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    Task { @MainActor in
      let (url, title) = await loadShared()
      let view = ShareView(url: url, title: title,
        onPick: { [weak self] later in
          if let url { Self.enqueue(url: url, title: title, later: later) }
          self?.extensionContext?.completeRequest(returningItems: nil)
        },
        onCancel: { [weak self] in self?.extensionContext?.cancelRequest(withError: NSError(domain: "app.tibi.share", code: 0)) })
      let host = UIHostingController(rootView: view)
      addChild(host); host.view.frame = self.view.bounds; host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      self.view.addSubview(host.view); host.didMove(toParent: self)
    }
  }

  private func loadShared() async -> (URL?, String?) {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let title = items.first?.attributedContentText?.string
    for provider in items.flatMap({ $0.attachments ?? [] }) {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
         let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, ["http", "https"].contains(url.scheme ?? "") {
        return (url, title)
      }
      if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
         let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
         let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), ["http", "https"].contains(url.scheme ?? "") {
        return (url, title)
      }
    }
    return (nil, title)
  }

  static func enqueue(url: URL, title: String?, later: Bool) {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.tibi")?.appendingPathComponent("share-inbox", isDirectory: true) else { return }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let body: [String: Any] = ["url": url.absoluteString, "title": title ?? "", "later": later, "at": Date().timeIntervalSince1970 * 1000]
    if let data = try? JSONSerialization.data(withJSONObject: body) {
      try? data.write(to: dir.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000)).json"), options: .atomic)
    }
  }
}

struct ShareView: View {
  let url: URL?
  let title: String?
  let onPick: (Bool) -> Void
  let onCancel: () -> Void
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack { Text("发送到 Tibi").font(.headline); Spacer(); Button("取消", action: onCancel) }
      if let url {
        Text(url.host ?? url.absoluteString).font(.caption).foregroundStyle(.secondary)
        Text(title?.isEmpty == false ? title! : url.absoluteString).font(.system(.title3, design: .serif)).bold().lineLimit(3)
        HStack(spacing: 10) {
          Button { onPick(false) } label: { Text("导入").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent)
          Button { onPick(true) } label: { Text("稍后读").frame(maxWidth: .infinity) }.buttonStyle(.bordered)
        }
        Text("打开 Tibi 时才抓取正文").font(.footnote).foregroundStyle(.secondary)
      } else {
        Text("这里没有网址。在 Safari 里打开一篇文章再分享。").foregroundStyle(.secondary)
      }
    }.padding(20)
  }
}
