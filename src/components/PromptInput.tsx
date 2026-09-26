import React, { useMemo, useState } from "react";
import type {
  GenerationMode,
  GenerationRequest,
  GenerationStyle,
  PromptHistory,
  StampCount,
} from "../types/index";
import { validatePrompt, validatePromptLength } from "../utils/validation";

/** プロンプト最大文字数（LINE 規格ではなくアプリ仕様上の上限） */
const MAX_PROMPT_LENGTH = 1000;

/** 選択可能なスタンプ枚数（要件 1.4） */
const STAMP_COUNT_OPTIONS: readonly StampCount[] = [8, 16, 24, 32, 40];

/** 選択可能な生成スタイル（要件 1.5） */
const STYLE_OPTIONS: readonly GenerationStyle[] = [
  "かわいい",
  "クール",
  "ゆるい",
  "リアル",
];

/** 生成モード選択肢（要件 1.6） */
const MODE_OPTIONS: readonly { value: GenerationMode; label: string }[] = [
  { value: "batch", label: "一括生成モード" },
  { value: "preview_approval", label: "プレビュー承認モード" },
];

export interface PromptInputProps {
  /** プロンプト送信時に呼ばれる（要件 1.3, 1.7 のトリガ） */
  onSubmit: (request: GenerationRequest) => void;
  /** プロンプト履歴（新しい順・最大 20 件） */
  history: PromptHistory[];
  /** 履歴選択時にプロンプトテキストを反映する（要件 1.8） */
  onHistorySelect: (prompt: string) => void;
}

/**
 * PromptInput
 *
 * ユーザーのプロンプト入力フォームと送信コントロールを提供する。
 * - リアルタイム文字数表示（要件 1.2）
 * - 1000 文字超過でエラー表示・送信ボタン無効化（要件 1.2）
 * - 空文字・空白のみで「条件を入力してください」（要件 1.3）
 * - 枚数セレクタ（デフォルト 8）（要件 1.4）
 * - スタイルセレクタ（未選択可）（要件 1.5）
 * - 生成モードセレクタ（デフォルト batch）（要件 1.6）
 * - 履歴選択（要件 1.8）
 *
 * ユーザー向けテキストはすべて日本語。
 */
const PromptInput: React.FC<PromptInputProps> = ({
  onSubmit,
  history,
  onHistorySelect,
}) => {
  const [prompt, setPrompt] = useState<string>("");
  const [count, setCount] = useState<StampCount>(8);
  const [style, setStyle] = useState<GenerationStyle | "">("");
  const [mode, setMode] = useState<GenerationMode>("batch");
  /** 送信を試みたか（空エラーは送信時に表示する - 要件 1.3） */
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false);

  // リアルタイム文字数エラー（超過のみ）: 要件 1.2
  const lengthError = useMemo(() => validatePromptLength(prompt), [prompt]);
  // 送信可否判定用の全体エラー（空文字含む）: 要件 1.3
  const submitError = useMemo(() => validatePrompt(prompt), [prompt]);

  const isOverLength = lengthError !== null;
  // 送信ボタンは文字数超過時に無効化（要件 1.2）
  const isSubmitDisabled = isOverLength;

  // 表示するエラーメッセージ: 超過は常時、空文字は送信試行後に表示
  const displayedError = isOverLength
    ? lengthError?.message
    : submitAttempted
      ? submitError?.message ?? null
      : null;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setSubmitAttempted(true);

    // 空文字・空白のみ、または文字数超過は送信しない（要件 1.2, 1.3）
    if (validatePrompt(prompt) !== null) {
      return;
    }

    const request: GenerationRequest = {
      prompt,
      count,
      mode,
      ...(style !== "" ? { style } : {}),
    };
    onSubmit(request);
  };

  return (
    <form className="prompt-input" onSubmit={handleSubmit} noValidate>
      <div className="prompt-input__field">
        <label htmlFor="prompt-text">スタンプの条件（テーマ・スタイル・キャラクターなど）</label>
        <textarea
          id="prompt-text"
          name="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="例: ふわふわの白い子猫が笑ったり泣いたりするかわいいスタンプ"
          aria-invalid={displayedError !== null}
          aria-describedby="prompt-char-count prompt-error"
        />

        {/* リアルタイム文字数表示（要件 1.2） */}
        <div
          id="prompt-char-count"
          className={`prompt-input__char-count${isOverLength ? " is-over" : ""}`}
          aria-live="polite"
        >
          {prompt.length} / {MAX_PROMPT_LENGTH} 文字
        </div>

        {/* エラーメッセージ（要件 1.2, 1.3） */}
        {displayedError && (
          <p id="prompt-error" className="prompt-input__error" role="alert">
            {displayedError}
          </p>
        )}
      </div>

      {/* スタンプ枚数セレクタ（要件 1.4, デフォルト 8） */}
      <div className="prompt-input__field">
        <label htmlFor="stamp-count">スタンプ枚数</label>
        <select
          id="stamp-count"
          name="count"
          value={count}
          onChange={(e) => setCount(Number(e.target.value) as StampCount)}
        >
          {STAMP_COUNT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}枚
            </option>
          ))}
        </select>
      </div>

      {/* 生成スタイルセレクタ（要件 1.5, 未選択可） */}
      <div className="prompt-input__field">
        <label htmlFor="generation-style">生成スタイル（任意）</label>
        <select
          id="generation-style"
          name="style"
          value={style}
          onChange={(e) => setStyle(e.target.value as GenerationStyle | "")}
        >
          <option value="">指定しない</option>
          {STYLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      {/* 生成モードセレクタ（要件 1.6, デフォルト batch） */}
      <fieldset className="prompt-input__field">
        <legend>生成モード</legend>
        {MODE_OPTIONS.map((opt) => (
          <label key={opt.value} className="prompt-input__radio">
            <input
              type="radio"
              name="mode"
              value={opt.value}
              checked={mode === opt.value}
              onChange={() => setMode(opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      {/* プロンプト履歴（要件 1.8） */}
      {history.length > 0 && (
        <div className="prompt-input__field">
          <label htmlFor="prompt-history">履歴から選択</label>
          <select
            id="prompt-history"
            name="history"
            value=""
            onChange={(e) => {
              if (e.target.value !== "") {
                onHistorySelect(e.target.value);
              }
            }}
          >
            <option value="">履歴を選択...</option>
            {history.map((entry) => (
              <option key={entry.id} value={entry.text}>
                {entry.text.length > 30
                  ? `${entry.text.slice(0, 30)}…`
                  : entry.text}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        type="submit"
        className="prompt-input__submit"
        disabled={isSubmitDisabled}
      >
        生成する
      </button>
    </form>
  );
};

export default PromptInput;
