// A refused receipt: the server moves the subscription back to
// 'pending_payment', so only its latest receipt tells "refused" from "never
// paid" (needsNewReceipt), and the receipt's own state is drawn as a pill.
import 'package:flutter_test/flutter_test.dart';

import 'package:basak_mobile/core/ui/ui.dart';
import 'package:basak_mobile/features/student/subscription/models/subscription_model.dart';
import 'package:basak_mobile/features/student/subscription/presentation/uploaded_receipt.dart';

import 'support/pay_fixtures.dart';

void main() {
  group('needsNewReceipt', () {
    test('awaiting payment with the latest receipt refused: a new receipt is needed', () {
      expect(needsNewReceipt(boardSub('pending_payment'), boardReceipt(2, 'rejected', reason: 'x')), isTrue);
    });

    test('awaiting payment with nothing sent yet: just pay', () {
      expect(needsNewReceipt(boardSub('pending_payment'), null), isFalse);
    });

    test('awaiting payment after an accepted or pending receipt is not a refusal', () {
      expect(needsNewReceipt(boardSub('pending_payment'), boardReceipt(1, 'approved')), isFalse);
      expect(needsNewReceipt(boardSub('pending_payment'), boardReceipt(1, 'pending')), isFalse);
    });

    test('a subscription marked rejected (older data) needs one, with or without its receipts', () {
      expect(needsNewReceipt(boardSub('rejected'), null), isTrue);
      expect(needsNewReceipt(boardSub('rejected'), boardReceipt(1, 'rejected')), isTrue);
    });

    test('under review or running: never', () {
      final refused = boardReceipt(1, 'rejected', reason: 'x');
      expect(needsNewReceipt(boardSub('pending_review'), refused), isFalse);
      expect(needsNewReceipt(boardSub('active'), refused), isFalse);
      expect(needsNewReceipt(boardSub('expired', phase: 'expired'), refused), isFalse);
    });
  });

  test('the next attempt is named from the second receipt until the fifth', () {
    expect(nextAttemptLabel(0), isNull);
    expect(nextAttemptLabel(1), 'المحاولة 2 من 5');
    expect(nextAttemptLabel(4), 'المحاولة 5 من 5');
    expect(nextAttemptLabel(5), isNull);
  });

  test('a receipt\'s pill: under review, refused, accepted', () {
    expect(receiptPill(boardReceipt(1, 'pending')), (status: BasakStatus.pendingReview, label: null));
    expect(receiptPill(boardReceipt(1, 'rejected')), (status: BasakStatus.rejected, label: 'مرفوض'));
    expect(receiptPill(boardReceipt(1, 'approved')), (status: BasakStatus.active, label: 'مقبول'));
  });

  test('its picture is the student\'s own file in the receipts bucket', () {
    expect(receiptPhoto(boardReceipt(3, 'pending')), (bucket: 'receipts', path: 'me/sub1_3.jpg'));
  });
}
