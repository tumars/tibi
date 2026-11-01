#!/usr/bin/env python3
"""把 Safari 分享扩展和小组件加进 `tauri ios init` 生成的 xcodegen 工程（gen/apple/project.yml），再 xcodegen 重新生成 .xcodeproj。

- ShareExtension（app.tibi.share）：分享面板里的 Tibi，写 App Group 的 share-inbox/（ShareExtension/ShareViewController.swift）
- TibiWidget（app.tibi.widget）：主屏 / 锁屏小组件，读 App Group 的 widget.json（TibiWidget/TibiWidget.swift，iOS 17 起）
- 主应用和两个扩展都加 App Groups 能力（group.app.tibi），主应用依赖并内嵌两个扩展
可以重复跑（已经加过就跳过）。CI 的 ios-smoke 在 tauri ios init 之后跑；在 Mac 上手动做的话：
    cd apps/desktop && pnpm tauri ios init && python3 src-tauri/ios-extensions/add-targets.py
需要 pyyaml 和 xcodegen。
"""
import os
import subprocess
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
APPLE = os.path.join(HERE, '..', 'gen', 'apple')
SPEC = os.path.join(APPLE, 'project.yml')
GROUP = 'group.app.tibi'


def rel(*p):
    return os.path.relpath(os.path.join(HERE, *p), APPLE)


def main():
    with open(SPEC, encoding='utf-8') as f:
        spec = yaml.safe_load(f)
    targets = spec.setdefault('targets', {})
    app_name = next((n for n, t in targets.items() if t.get('type') == 'application' and t.get('platform', 'iOS') == 'iOS'), None)
    if not app_name:
        sys.exit(f'{SPEC} 里没有 iOS 应用 target')
    app = targets[app_name]
    bundle = (app.get('settings', {}).get('base', {}) or {}).get('PRODUCT_BUNDLE_IDENTIFIER') or spec.get('options', {}).get('bundleIdPrefix', 'app') + '.tibi'

    # 主应用：App Groups（壳的 app_group.rs 经它找共享目录）
    ent = app.setdefault('entitlements', {'path': f'{app_name}/{app_name}.entitlements'})
    props = ent.setdefault('properties', {})
    props['com.apple.security.application-groups'] = [GROUP]

    exts = {
        'ShareExtension': {
            'type': 'app-extension',
            'platform': 'iOS',
            'deploymentTarget': '16.0',
            'sources': [{'path': rel('ShareExtension')}],
            'info': {
                'path': 'ShareExtension/Info.plist',
                'properties': {
                    'CFBundleDisplayName': 'Tibi',
                    'NSExtension': {
                        'NSExtensionPointIdentifier': 'com.apple.share-services',
                        'NSExtensionPrincipalClass': '$(PRODUCT_MODULE_NAME).ShareViewController',
                        'NSExtensionAttributes': {'NSExtensionActivationRule': {'NSExtensionActivationSupportsWebURLWithMaxCount': 1}},
                    },
                },
            },
            'entitlements': {'path': 'ShareExtension/ShareExtension.entitlements', 'properties': {'com.apple.security.application-groups': [GROUP]}},
            'settings': {'base': {'PRODUCT_BUNDLE_IDENTIFIER': f'{bundle}.share', 'SWIFT_VERSION': '5.0', 'TARGETED_DEVICE_FAMILY': '1,2'}},
        },
        'TibiWidget': {
            'type': 'app-extension',
            'platform': 'iOS',
            'deploymentTarget': '17.0',
            'sources': [{'path': rel('TibiWidget')}],
            'info': {
                'path': 'TibiWidget/Info.plist',
                'properties': {
                    'CFBundleDisplayName': 'Tibi',
                    'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.widgetkit-extension'},
                },
            },
            'entitlements': {'path': 'TibiWidget/TibiWidget.entitlements', 'properties': {'com.apple.security.application-groups': [GROUP]}},
            'settings': {'base': {'PRODUCT_BUNDLE_IDENTIFIER': f'{bundle}.widget', 'SWIFT_VERSION': '5.0', 'TARGETED_DEVICE_FAMILY': '1,2'}},
        },
    }
    deps = app.setdefault('dependencies', [])
    for name, t in exts.items():
        targets[name] = t
        if not any(d.get('target') == name for d in deps):
            deps.append({'target': name, 'embed': True})

    with open(SPEC, 'w', encoding='utf-8') as f:
        yaml.safe_dump(spec, f, allow_unicode=True, sort_keys=False)
    print(f'{app_name}（{bundle}）加上 App Group，内嵌 ShareExtension（{bundle}.share）、TibiWidget（{bundle}.widget）')
    subprocess.run(['xcodegen', 'generate', '--spec', SPEC], cwd=APPLE, check=True)


if __name__ == '__main__':
    main()
