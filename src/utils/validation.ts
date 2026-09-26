/**
 * バリデーションユーティリティ
 *
 * 純粋関数のみ定義する（副作用なし）。
 * プロパティベーステストの対象。
 *
 * 各バリデーション関数はエラーがない場合 null を返し、
 * エラーがある場合は ValidationError を返す。
 *
 * タスク 10, 13 で各関数の実装を行う。
 */

import type { ValidationError } from "../types/index";

/**
 * プロンプトテキストをバリデーションする。
 * - 空文字・空白のみは「条件を入力してください」
 * - 1001 文字以上は「1000文字以内で入力してください」
 * Property 1, 2 対象
 */
export function validatePrompt(text: string): ValidationError | null {
  if (text.trim().length === 0) {
    return {
      field: "prompt",
      message: "条件を入力してください",
    };
  }
  if (text.length > 1000) {
    return {
      field: "prompt",
      message: `1000文字以内で入力してください（現在 ${text.length} 文字）`,
    };
  }
  return null;
}

/**
 * プロンプト文字数のみをバリデーションする（リアルタイム表示用）。
 * Property 1 対象
 */
export function validatePromptLength(text: string): ValidationError | null {
  if (text.length > 1000) {
    return {
      field: "prompt",
      message: `1000文字以内で入力してください（現在 ${text.length} 文字）`,
    };
  }
  return null;
}

/**
 * スタンプセットタイトルをバリデーションする。
 * - 0 文字または 41 文字以上はエラー
 * - 1〜40 文字は OK
 * Property 9 対象
 */
export function validateTitle(title: string): ValidationError | null {
  if (title.length === 0) {
    return {
      field: "title",
      message: "タイトルを入力してください",
    };
  }
  if (title.length > 40) {
    return {
      field: "title",
      message: `タイトルは40文字以内で入力してください（現在 ${title.length} 文字）`,
    };
  }
  return null;
}

/**
 * スタンプセット説明をバリデーションする。
 * - 161 文字以上はエラー
 * - 0〜160 文字は OK
 * Property 9 対象
 */
export function validateDescription(description: string): ValidationError | null {
  if (description.length > 160) {
    return {
      field: "description",
      message: `説明は160文字以内で入力してください（現在 ${description.length} 文字）`,
    };
  }
  return null;
}

/**
 * ファイル種別をバリデーションする。
 * PNG 以外はエラー（大文字小文字を区別しない）。
 * Property 10 対象
 */
export function validateFileType(filename: string): ValidationError | null {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".png")) {
    return {
      field: "file",
      message: "PNG形式のファイルを選択してください",
    };
  }
  return null;
}
