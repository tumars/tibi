// 小组件（00 §3.13 J7）：主屏小号（待复习数 + 连续天数）、中号（继续读的文章与进度 + 复习数）；锁屏圆环（今日分钟）与一行文字。
// 读主应用写在 App Group 里的 widget.json（壳的 widget_write，app_group.rs），自己不同步。狐狸只有平静和开心两种状态。
// 未在 Xcode 里编译验证（这份代码在 Linux 上写的），加 target 的步骤见 README.md。
import SwiftUI
import WidgetKit

struct Snapshot: Codable {
  var due: Int = 0
  var streak: Int = 0
  var todayMinutes: Int = 0
  var goal: Int = 20
  var readingTitle: String?
  var readingProgress: Double?
  static func load() -> Snapshot {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.tibi")?.appendingPathComponent("widget.json"),
          let data = try? Data(contentsOf: url), let s = try? JSONDecoder().decode(Snapshot.self, from: data) else { return Snapshot() }
    return s
  }
}

struct Entry: TimelineEntry { let date: Date; let snap: Snapshot }

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> Entry { Entry(date: .now, snap: Snapshot(due: 12, streak: 9, todayMinutes: 12)) }
  func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, snap: .load())) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
    completion(Timeline(entries: [Entry(date: .now, snap: .load())], policy: .after(.now.addingTimeInterval(30 * 60))))
  }
}

struct TibiWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: Entry
  var happy: Bool { entry.snap.due == 0 || entry.snap.todayMinutes >= entry.snap.goal }
  var body: some View {
    switch family {
    case .accessoryCircular:
      Gauge(value: Double(min(entry.snap.todayMinutes, entry.snap.goal)), in: 0...Double(max(entry.snap.goal, 1))) { Text("分") } currentValueLabel: { Text("\(entry.snap.todayMinutes)") }
        .gaugeStyle(.accessoryCircularCapacity)
    case .accessoryInline:
      Text("复习 \(entry.snap.due) · 连续 \(entry.snap.streak) 天")
    case .systemMedium:
      HStack(alignment: .top, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          Text(entry.snap.readingTitle ?? "今天想读点什么？").font(.system(.headline, design: .serif)).lineLimit(2)
          if let p = entry.snap.readingProgress { ProgressView(value: p) }
          Spacer()
          Text("复习 \(entry.snap.due) 张").font(.caption)
        }
        Text(happy ? "🦊✨" : "🦊").font(.largeTitle)
      }
    default:
      VStack(alignment: .leading) {
        Text(happy ? "🦊✨" : "🦊").font(.largeTitle)
        Spacer()
        Text("\(entry.snap.due)").font(.system(size: 30, weight: .bold))
        Text("待复习 · 连续 \(entry.snap.streak) 天").font(.caption)
      }
    }
  }
}

@main
struct TibiWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "TibiWidget", provider: Provider()) { entry in
      TibiWidgetView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Tibi")
    .description("待复习数、连续天数和继续读的文章")
    .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryInline])
  }
}
