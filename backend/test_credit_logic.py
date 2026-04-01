import pathlib
import sys
import unittest
from datetime import date


BACKEND_DIR = pathlib.Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from credit_logic import (  # type: ignore
    add_months,
    apply_credit_spend,
    apply_credit_payment,
    apply_overdue_interest,
    calculate_minimum_credit_payment,
)


class CreditLogicTests(unittest.TestCase):
    def test_spending_credit_money_keeps_debt_unchanged(self):
        new_available, new_debt = apply_credit_spend(
            available_balance=5_000_000,
            debt_amount=5_000_000,
            spend_amount=1_000_000,
        )

        self.assertEqual(new_available, 4_000_000)
        self.assertEqual(new_debt, 5_000_000)

    def test_credit_payment_reduces_only_debt(self):
        new_available, new_debt = apply_credit_payment(
            available_balance=4_000_000,
            debt_amount=5_000_000,
            payment_amount=500_000,
        )

        self.assertEqual(new_available, 4_000_000)
        self.assertEqual(new_debt, 4_500_000)

    def test_minimum_payment_is_based_on_original_amount_and_term(self):
        self.assertEqual(
            calculate_minimum_credit_payment(
                original_amount=5_000_000,
                term_months=12,
                debt_amount=4_000_000,
            ),
            416_666.67,
        )

    def test_add_months_preserves_expected_payment_cycle(self):
        self.assertEqual(add_months(date(2026, 4, 16), 1), date(2026, 5, 16))

    def test_overdue_interest_is_applied_per_missed_period(self):
        self.assertEqual(
            apply_overdue_interest(
                debt_amount=5_000_000,
                monthly_rate=0.03,
                overdue_periods=1,
            ),
            5_150_000.0,
        )


if __name__ == "__main__":
    unittest.main()
