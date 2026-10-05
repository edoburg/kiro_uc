import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { GenerationOptions, GenerationPreset, GenerationPresetList, GenerationRequest } from "../types";
import { createPresetSnapshot, GENERATION_MODELS, GENERATION_QUALITIES, validatePresetName } from "../utils/generationPreset";

interface Props {
  request: GenerationRequest;
  options: GenerationOptions;
  locked: boolean;
  hasResults: boolean;
  onOptionsChange: (options: GenerationOptions) => void;
  onLoad: (preset: GenerationPreset) => boolean;
  onBusyChange: (busy: boolean) => void;
}

export default function GenerationPresetPanel({ request, options, locked, hasResults, onOptionsChange, onLoad, onBusyChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const [list, setList] = useState<GenerationPresetList>({ presets: [], issues: [] });
  const [name, setName] = useState("");
  const [active, setActive] = useState<GenerationPreset | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [copyTarget, setCopyTarget] = useState<{ id: string; name: string } | null>(null);
  const [copyName, setCopyName] = useState("");
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);
  const lock = useRef(locked); lock.current = locked;
  let fingerprint: string;
  try { fingerprint = JSON.stringify(createPresetSnapshot(request, options)); }
  catch { fingerprint = "invalid-draft"; }
  const dirty = savedSnapshot !== fingerprint || (active !== null && name.trim() !== active.name);
  const refresh = useCallback(async () => {
    if (window.api?.generationPresets) setList(await window.api.generationPresets.list());
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (window.api?.generationPresets) {
      setBusy("一覧を読み込み中…");
      window.api.generationPresets.list().then((value) => { if (!cancelled) setList(value); })
        .catch(() => { if (!cancelled) setError("保存済み設定一覧を読み込めませんでした。再読み込みしてください。"); })
        .finally(() => { if (!cancelled) setBusy(null); });
    }
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!expanded) { restoreFocus.current = null; return; }
    if (busy !== null || locked || !restoreFocus.current) return;
    const target = restoreFocus.current;
    restoreFocus.current = null;
    if (target.isConnected && !target.matches(":disabled") && target !== document.body) target.focus();
    else nameInput.current?.focus();
  }, [busy, locked, expanded]);
  const run = async (label: string, operation: () => Promise<void>) => {
    if (inFlight.current || lock.current || busy) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : nameInput.current;
    inFlight.current = true; setBusy(label); onBusyChange(true); setError(null); setMessage("");
    try {
      if (!window.api?.generationPresets) throw new Error("生成設定の保存・読み込みはデスクトップアプリで利用できます。");
      await operation();
    } catch (error) { setError(error instanceof Error ? error.message : "生成設定の操作に失敗しました。"); }
    finally { inFlight.current = false; setBusy(null); onBusyChange(false); }
  };
  const save = (overwrite: boolean) => {
    if (overwrite && !active) return;
    void run("保存中…", async () => {
      const snapshot = createPresetSnapshot(request, options);
      const preset = await window.api!.generationPresets.save({ name: validatePresetName(name), snapshot, ...(overwrite && active ? { id: active.id } : {}) });
      setActive(preset); setName(preset.name); setSavedSnapshot(JSON.stringify(snapshot)); setMessage("保存しました。");
      setConfirmOverwrite(false);
      await refresh();
    });
  };
  const load = (id: string) => {
    if ((dirty || hasResults) && !window.confirm("現在の未保存編集を置き換え、生成画像・変換結果を画面から外します。画像は保存されません。生成設定を読み込みますか？")) return;
    void run("読み込み中…", async () => {
      const preset = await window.api!.generationPresets.load(id);
      if (lock.current || !onLoad(preset)) throw new Error("生成・変換中は作業設定を切り替えられません。");
      setActive(preset); setName(preset.name); setSavedSnapshot(JSON.stringify(createPresetSnapshot(preset.request, preset.options)));
      setCopyTarget(null);
      setConfirmOverwrite(false);
      setMessage("読み込みました。画像生成は開始していません。");
    });
  };
  const remove = (id: string, label: string) => {
    if (!window.confirm(`「${label}」を削除しますか？現在の作業内容は保持します。`)) return;
    void run("削除中…", async () => {
      await window.api!.generationPresets.delete(id);
      if (active?.id === id) { setActive(null); setSavedSnapshot(null); }
      if (copyTarget?.id === id) setCopyTarget(null);
      setMessage("削除しました。"); await refresh();
    });
  };
  const saveCopy = () => {
    if (!copyTarget) return;
    void run("別名で保存中…", async () => {
      const alias = validatePresetName(copyName);
      const source = await window.api!.generationPresets.load(copyTarget.id);
      await window.api!.generationPresets.save({ name: alias, snapshot: createPresetSnapshot(source.request, source.options) });
      setCopyTarget(null);
      setMessage("別名で保存しました。現在の作業内容は変更していません。");
      await refresh();
    });
  };
  return <section className="generation-preset-panel" aria-label="生成設定の保存と読み込み">
    <h2 className="generation-preset-heading"><button type="button" className="generation-preset-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded((value) => !value)}>
      <span aria-hidden="true">{expanded ? "▼" : "▶"}</span> 生成設定の保存と読み込み
    </button></h2>
    <div id={contentId} hidden={!expanded}>
    <p>共通設定と個別条件を保存します。画像は保存されません。レビューでは確定済みの条件を保存します。</p>
    <fieldset disabled={locked || busy !== null}>
      <legend>この作業で使うモデル・品質（グローバル設定は変更しません）</legend>
      <label>作業の生成モデル<select aria-label="作業の生成モデル" value={options.model} onChange={(event) => onOptionsChange({ ...options, model: event.target.value as GenerationOptions["model"] })}>{GENERATION_MODELS.map((model) => <option key={model}>{model}</option>)}</select></label>
      <label>作業の生成品質<select aria-label="作業の生成品質" value={options.quality} onChange={(event) => onOptionsChange({ ...options, quality: event.target.value as GenerationOptions["quality"] })}>{GENERATION_QUALITIES.map((quality) => <option key={quality}>{quality}</option>)}</select></label>
      <label>生成設定の保存名<input ref={nameInput} value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
      <div className="generation-preset-actions">
        <button type="button" onClick={() => save(false)}>名前を付けて保存</button>
        <button type="button" disabled={!active} onClick={() => { setConfirmOverwrite(true); setError(null); }}>上書き保存</button>
        <button type="button" onClick={() => void run("一覧を読み込み中…", refresh)}>一覧を再読み込み</button>
      </div>
      {confirmOverwrite && active && <fieldset aria-label="生成設定の上書き確認">
        <legend>上書き保存の確認</legend>
        <p>「{active.name}」を現在の確定済み設定で上書きしますか？</p>
        <div className="generation-preset-actions">
          <button type="button" autoFocus onClick={() => save(true)}>この設定を上書きする</button>
          <button type="button" onClick={() => { setConfirmOverwrite(false); nameInput.current?.focus(); }}>上書きをキャンセル</button>
        </div>
      </fieldset>}
      <p>{active ? `選択中：${active.name} ／ ` : ""}{dirty ? "未保存の変更があります" : "保存済み"}</p>
      <ul className="generation-preset-list" aria-label="保存済み生成設定">
        {list.presets.map((preset) => <li key={preset.id}>
          <strong>{preset.name}</strong> ／ {preset.count}枚 ／ {preset.theme === "daily" ? "日常の挨拶" : "仕事で使う言葉"} ／ 更新：{new Date(preset.updatedAt).toLocaleString("ja-JP")}
          <div className="generation-preset-actions">
            <button type="button" aria-label={`${preset.name}を読み込み`} onClick={() => load(preset.id)}>読み込み</button>
            <button type="button" aria-label={`${preset.name}を別名保存`} onClick={() => {
              setCopyTarget({ id: preset.id, name: preset.name });
              setCopyName(`${preset.name.slice(0, 96)}のコピー`);
              setError(null); setMessage("");
            }}>別名保存</button>
            <button type="button" aria-label={`${preset.name}を削除`} onClick={() => remove(preset.id, preset.name)}>削除</button>
          </div>
        </li>)}
      </ul>
      {copyTarget && <fieldset aria-label="生成設定の別名保存">
        <legend>「{copyTarget.name}」を別名保存</legend>
        <label>別名の保存名<input autoFocus value={copyName} maxLength={100} onChange={(event) => setCopyName(event.target.value)} /></label>
        <div className="generation-preset-actions">
          <button type="button" onClick={saveCopy}>この名前でコピーを保存</button>
          <button type="button" onClick={() => { setCopyTarget(null); setError(null); }}>別名保存をキャンセル</button>
        </div>
      </fieldset>}
      {list.presets.length === 0 && <p>保存済みの生成設定はありません。</p>}
      {list.issues.map((issue, index) => <p key={issue.id ?? index}>読み込めない設定：{issue.message} {issue.id && <button type="button" onClick={() => remove(issue.id!, "読み込めない設定")}>破損した設定を削除</button>}</p>)}
    </fieldset>
    {locked && <p>生成・変換・出力中は設定の保存・読み込みと切り替えを停止しています。</p>}
    <p role="status">{busy ?? message}</p>
    {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
