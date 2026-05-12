from pathlib import Path
import re
import sys
import textwrap

from docx import Document


def line_with_underscores(prefix: str, content: str, total_len: int) -> str:
    base = f"{prefix}{content}".rstrip()
    needed = max(6, total_len - len(base))
    return base + ("_" * needed)


def underscore_only(total_len: int) -> str:
    return "_" * total_len


def fill_section(paragraphs, start_idx: int, end_idx: int, title_prefix: str, text: str, title_len: int, body_len: int):
    wrapped = textwrap.wrap(text, width=body_len, break_long_words=False, break_on_hyphens=False)
    if not wrapped:
        wrapped = [""]

    paragraphs[start_idx].text = line_with_underscores(title_prefix, " " + wrapped[0], title_len)

    body_slots = list(range(start_idx + 1, end_idx + 1))
    remaining = wrapped[1:]
    for idx in body_slots:
        if remaining:
            paragraphs[idx].text = line_with_underscores("", remaining.pop(0), body_len)
        else:
            paragraphs[idx].text = underscore_only(body_len)


def main(src: str, dst: str) -> None:
    doc = Document(src)
    p = doc.paragraphs

    # Header block
    p[3].text = line_with_underscores("обучающегося ", "Киреева Даниила Витальевича", 82)
    p[5].text = line_with_underscores("специальности ", "09.02.07 «Информационные системы и программирование»", 82)
    p[6].text = line_with_underscores("", "Западного филиала РАНХиГС", 82)

    theme = "«Разработка информационной системы обслуживания клиентов банка на платформе ВКонтакте»"
    theme_lines = textwrap.wrap(theme, width=74, break_long_words=False, break_on_hyphens=False)
    p[7].text = line_with_underscores("Тема ", theme_lines[0], 82)
    p[8].text = line_with_underscores("", theme_lines[1] if len(theme_lines) > 1 else "", 82)

    # Sections compressed to template lines
    fill_section(
        p,
        10,
        14,
        "1. Актуальность темы работы ",
        "Тема актуальна в связи с развитием цифровых банковских сервисов, распространением дистанционного обслуживания клиентов и востребованностью интеграции финансовых функций в платформу ВКонтакте.",
        88,
        82,
    )
    fill_section(
        p,
        15,
        18,
        "2. Характеристика методов решения задач, поставленных в работе, использование вычислительной техники ",
        "В работе использованы анализ предметной области, проектирование архитектуры и базы данных, разработка клиентского интерфейса, серверной логики и административного контура с применением React, FastAPI, PostgreSQL, Docker и VK API.",
        112,
        78,
    )
    fill_section(
        p,
        19,
        21,
        "3. Анализ взаимосвязи всех разделов работы ",
        "Все разделы работы логически взаимосвязаны: аналитическая часть обосновывает проектные решения, а этапы реализации и тестирования подтверждают достижение поставленной цели.",
        88,
        82,
    )
    fill_section(
        p,
        22,
        23,
        "4. Основные достоинства работы, качество ее оформления ",
        "К достоинствам относятся актуальность темы, комплексный характер проекта, наличие архитектурных схем, ER-диаграммы, таблиц и качественно оформленных материалов.",
        88,
        82,
    )
    fill_section(
        p,
        24,
        26,
        "5. Значимость предложений и выводов ",
        "Практическая значимость работы состоит в демонстрации возможности реализации клиент-серверной банковской системы на платформе ВКонтакте с пользовательским и административным контурами.",
        88,
        82,
    )
    fill_section(
        p,
        27,
        28,
        "6. Замечания по работе и ее недостатки ",
        "Отдельные элементы проекта носят учебно-прикладной характер и могут быть дополнительно развиты в части ролевой модели, безопасности и аналитики.",
        88,
        82,
    )
    fill_section(
        p,
        29,
        30,
        "7. Работа заслуживает ",
        "положительной оценки, а ее автор - присвоения квалификации по специальности 09.02.07 «Информационные системы и программирование».",
        88,
        82,
    )

    p[32].text = line_with_underscores("РЕЦЕНЗЕНТ ", "Богачев В.И.", 82)
    p[33].text = line_with_underscores("", "директор ООО «45 Кейс»", 82)

    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    doc.save(dst)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
