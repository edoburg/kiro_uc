"""確定した企画項目から一枚分の画像生成プロンプトを構築する。"""


def build_stamp_prompt(common_prompt: str, item: dict) -> str:
    prop = item["prop"].strip() or "なし"
    additional = (item.get("additional_instructions") or "").strip()
    additional_section = (
        f"【今回のスタンプへの追加指示】\n{additional}\n\n" if additional else ""
    )
    if item.get("text_enabled", False):
        display_text = item.get("display_text")
        text = (item["meaning"] if display_text is None else display_text).strip()
        text_section = (
            "【文字の指定】\n文字を入れる：はい\n"
            f"画像に描く文字：「{text}」\n\n"
            "【文字の出力ルール】\n"
            "指定した文字を、省略・言い換え・翻訳せずにそのまま描く。"
            "文字は丸く柔らかな手書き風とし、イラストに合うデザインにする。"
            "線の太さや傾きに自然な変化をつけ、読みやすさを優先する。"
            "読みやすい縁取りをつけ、顔に重ねず、画像内に収める。"
            "指定した言葉以外の文字は描かない。\n"
        )
    else:
        text_section = (
            "【文字の指定】\n文字を入れる：いいえ\n\n"
            "【文字の出力ルール】\n"
            "文字、数字、記号によるメッセージやロゴを描かない。"
            "意味は表情・ポーズ・小物で表す。\n"
        )
    return (
        "【共通設定】\n"
        f"{common_prompt.strip()}\n\n"
        "【今回のスタンプ】\n"
        f"伝えたい意味：{item['meaning'].strip()}\n"
        f"表情：{item['expression'].strip()}\n"
        f"ポーズ：{item['pose'].strip()}\n"
        f"小物：{prop}\n\n"
        f"{additional_section}"
        "【出力ルール】\n"
        "共通のキャラクターの外見・色・画風を維持する。"
        "今回の意味・表情・ポーズのスタンプを1種類だけ描く。"
        "意味を表情・ポーズで表す。"
        "背景透過。コラージュや複数コマにしない。"
        "\n\n"
        f"{text_section}"
        "文字の有無と内容は【文字の指定】を共通設定・追加指示より優先する。"
        "共通設定や追加指示の説明文を表示文字として描かない。"
    )
