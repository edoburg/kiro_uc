"""確定した企画項目から一枚分の画像生成プロンプトを構築する。"""


def build_stamp_prompt(common_prompt: str, item: dict) -> str:
    prop = item["prop"].strip() or "なし"
    return (
        "【共通設定】\n"
        f"{common_prompt.strip()}\n\n"
        "【今回のスタンプ】\n"
        f"伝えたい意味：{item['meaning'].strip()}\n"
        f"表情：{item['expression'].strip()}\n"
        f"ポーズ：{item['pose'].strip()}\n"
        f"小物：{prop}\n\n"
        "【出力ルール】\n"
        "共通のキャラクターの外見・色・画風を維持する。"
        "今回の意味・表情・ポーズのスタンプを1種類だけ描く。"
        "文字を描かず、意味を表情・ポーズで表す。"
        "背景透過。コラージュや複数コマにしない。"
    )
