# 天依わな育成シミュレーション

## プロジェクト概要

HTML・CSS・JavaScriptで開発する、天依わなを中心とした育成シミュレーションゲームです。ノベルゲーム形式の会話と、時間・スタミナ・好感度などを管理するゲーム進行を組み合わせることを目指しています。

ゲームの詳細な要件や開発上の制約は、開発指示書である [README.md](./README.md) を参照してください。

## 現在の状態

開発初期段階です。Vite上で動作する仮UIをゲームエンジンとIndexedDBへ接続しています。ゲーム内部の状態・時間・行動・イベント・エンディング判定を実装済みです。正式デザイン、シナリオ、バランス数値は開発中です。

### 実装済み

- Viteを使った開発サーバーと本番ビルド
- JavaScript ES Modulesによるエントリーポイント
- HTMLとCSSを分離した初期画面
- YAMLデータの実行時読み込み、構文・スキーマ・参照検証
- 52件の開発用ステージデータ、イベントとエンディングの検証用サンプル
- GameState、難易度固定、ゲーム時間、ステージ移行待ち
- YAML定義の行動、スタミナ不足補正、イベント進行、分岐、エンディング判定
- IndexedDBの手動5枠・オート1枠セーブ、検証付きロード、JSONエクスポート
- スロット共通のエンディング回収記録
- GameEngineとIndexedDBを接続した仮Home・Loading・Config・ノベルゲーム画面
- 行動・イベント会話・選択肢・ステージ遷移・セーブ/ロード/JSON出力の画面操作
- エンディング結果・回収一覧と、開発用サンプルイベント解放操作
- 背景中心のサウンドノベル仮表示、名前なしの地の文、任意のローカル背景・シルエット素材
- BGM/効果音用の演出イベント（`game:presentation`）を文章表示処理と分離

### これから実装する主な機能

- 正式版のステージ・行動・イベント・エンディング条件・シナリオデータと数値調整
- Figmaに基づく正式なHome/Loading/Config画面と本編デザイン
- 会話ログ、オート再生、既読スキップなどのノベルゲーム機能
- ゲーム内デバッグ機能

開発用のステージ日時、行動コスト、難易度補正、イベント、エンディング条件、シナリオは仮データです。正式なシナリオやバランス値として確定していません。

## ゲームデータ

ゲームデータはYAMLファイルを実行時に直接解析します。`stages.yaml` は52ステージの日付と共通の開始・終了時刻、`settings.yaml` はパラメータ・難易度補正・不足時ペナルティ・イベント選択重み、`actions.yaml` は各行動のカテゴリ・時間/スタミナコスト・効果を定義します。

イベント条件は `all`（AND）と `any`（OR）を使った入れ子形式で、葉条件は `parameter` または `flag`、`operator`、`value` で記述します。イベントのステージ、種別、繰り返し方、会話、選択肢、効果、分岐、関連エンディング、後回し後の再提示条件もYAMLに定義します。会話行は `text` を必須とし、`speaker` は省略可能です。仮UIは行ごとの `backgroundImage` と `silhouetteImage` に同一オリジンのローカルアセットパスを指定でき、未指定シルエットは表示しません。`bgm` と `soundEffects` のキューは `game:presentation` イベントで文章表示から分離して通知し、音声再生自体は後工程で接続します。エンディング一覧の `trigger` には `immediate` または `stageEnd` と条件を記述し、シナリオ本文は個別ファイルに分離します。

ゲームロジックは `src/game/` 以下の状態、時間、条件、行動、イベント、エンディング各モジュールで構成しています。セーブ処理は `src/storage/` のリポジトリに分離し、ゲームエンジンへ自動保存コールバックを注入します。

IndexedDBは `slots` と `endings` の2ストアを使用します。スロットはプロフィール単位で手動5枠とオート1枠を独立管理し、エンディング回収記録はプロフィール単位で全スロット共通です。保存形式・状態スキーマのバージョンを検査し、破損・未対応データを自動初期化・上書きしません。JSONエクスポートは手動・オートいずれかのスロット単位です。インポート機能はありません。

ゲーム画面などから `IndexedDBSaveRepository` を生成し、`GameEngine` の `autoSave` オプションに `createAutoSaveHandler(repository)` を指定すると、行動終了時と確認済みステージ移行時に自動保存します。自動保存の失敗は操作結果の `autoSave.success` と `autoSave.error` で確認できます。手動保存は `repository.saveManual(engine, "manual-1")` のように実行し、イベント処理中やステージ移行待ちでは拒否されます。ロードは `repository.load(engine, "manual-1")` です。

## 技術構成

- Vite
- HTML
- CSS
- JavaScript（ES Modules）
- ゲームシナリオ・設定データ形式：YAML
- 将来のローカルセーブ：IndexedDB

UIフレームワークは使用しません。Firebase連携は将来の検討対象で、初期段階では必須にしません。

## 開発方法

Node.jsとnpmを用意し、リポジトリのルートで以下を実行します。

```sh
npm install
npm run dev
```

本番ビルドは次のコマンドで確認できます。

```sh
npm run build
```

YAMLデータの検証と自動テストは次のコマンドで実行します。

```sh
npm run validate:data
npm test
```

生成されたビルドをローカルで確認する場合は、ビルド後に次を実行します。

```sh
npm run preview
```

## ディレクトリ構成

```text
.
├── data/
│   ├── settings.yaml
│   ├── actions.yaml
│   ├── stages.yaml
│   ├── events.yaml
│   └── endings/
│       ├── index.yaml
│       └── scenarios/
├── scripts/
│   └── validate-data.js
├── index.html
├── src/
│   ├── main.js
│   ├── style.css
│   ├── ui/
│   │   ├── app.js
│   │   └── views.js
│   ├── data/
│   │   ├── runtime-data.js
│   │   └── validate.js
│   ├── storage/
│   │   └── indexeddb-save-repository.js
│   └── game/
│       ├── state.js
│       ├── save-state.js
│       ├── time.js
│       ├── conditions.js
│       ├── effects.js
│       ├── actions.js
│       ├── events.js
│       ├── endings.js
│       └── engine.js
├── tests/
│   ├── data-validation.test.js
│   ├── game-engine.test.js
│   ├── save-storage.test.js
│   └── ui-view.test.js
├── package.json
├── package-lock.json
├── README.md
└── PROJECT_OVERVIEW.md
```

機能の実装に応じて、データ、ゲームロジック、保存処理などを責務ごとに分けて追加する予定です。
