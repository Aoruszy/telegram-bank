import pathlib
import sys
import unittest


BACKEND_DIR = pathlib.Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from credit_logic import (  # type: ignore
    apply_credit_spend,
    apply_credit_payment,
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


if __name__ == "__main__":
    unittest.main()
