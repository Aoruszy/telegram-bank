def apply_credit_spend(
    available_balance: float,
    debt_amount: float,
    spend_amount: float,
) -> tuple[float, float]:
    return round(available_balance - spend_amount, 2), round(debt_amount, 2)


def apply_credit_payment(
    available_balance: float,
    debt_amount: float,
    payment_amount: float,
) -> tuple[float, float]:
    return round(available_balance, 2), round(max(0.0, debt_amount - payment_amount), 2)


def calculate_minimum_credit_payment(
    original_amount: float,
    term_months: int,
    debt_amount: float,
) -> float:
    if debt_amount <= 0:
        return 0.0
    scheduled_payment = (
        round(original_amount / max(term_months, 1), 2)
        if original_amount > 0
        else round(debt_amount, 2)
    )
    return round(min(debt_amount, scheduled_payment), 2)
