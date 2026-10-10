import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/constants/supabase_config.dart';
import '../../../../core/media/signed_photo.dart';
import '../../../../core/theme/app_icons.dart';
import '../../../../core/ui/ui.dart';
import '../../../../core/widgets/avatar_image.dart';
import '../models/subscription_model.dart';

/// The picture of a receipt the student sent, in the private 'receipts'
/// bucket ("{student}/{subscription}_{key}.jpg"). The student reads their own
/// folder ("Scoped receipt image access").
StoragePhoto receiptPhoto(ReceiptModel receipt) => (bucket: SupabaseConfig.receiptsBucket, path: receipt.imageUrl);

/// The receipt's own state as a pill: under review, refused or accepted.
/// (The subscription's statuses name the colours; the words are the receipt's.)
({BasakStatus status, String? label}) receiptPill(ReceiptModel receipt) => switch (receipt.status) {
      'approved' => (status: BasakStatus.active, label: 'مقبول'),
      'rejected' => (status: BasakStatus.rejected, label: 'مرفوض'),
      _ => (status: BasakStatus.pendingReview, label: null),
    };

/// «الإيصال المرفوع»: the last receipt the student sent for a subscription,
/// when it was sent, where it stands, and «عرض الإيصال» to look at its picture.
class UploadedReceiptCard extends StatelessWidget {
  final ReceiptModel receipt;

  /// "أُرسل اليوم 3:40 م".
  final String sentAt;

  /// Opens the picture; defaults to [ReceiptImageViewer.open].
  final VoidCallback? onView;

  const UploadedReceiptCard({super.key, required this.receipt, required this.sentAt, this.onView});

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final text = context.text;
    final pill = receiptPill(receipt);
    return BasakCard(
      padding: const EdgeInsetsDirectional.fromSTEB(BasakSpace.s18, BasakSpace.s14, BasakSpace.s18, BasakSpace.s10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('الإيصال المرفوع', style: text.body.copyWith(fontWeight: FontWeight.w500)),
                    if (sentAt.isNotEmpty)
                      Text(sentAt,
                          key: const Key('uploaded-receipt-date'),
                          style: text.caption.copyWith(color: colors.ink3)),
                  ],
                ),
              ),
              const SizedBox(width: BasakSpace.s10),
              StatusChip(pill.status, label: pill.label, key: const Key('uploaded-receipt-status')),
            ],
          ),
          const SizedBox(height: BasakSpace.s6),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: BasakButton(
              key: const Key('uploaded-receipt-view'),
              label: 'عرض الإيصال',
              icon: LucideIcons.image,
              variant: BasakButtonVariant.quiet,
              size: BasakButtonSize.small,
              expand: false,
              onPressed: onView ?? () => ReceiptImageViewer.open(context, receipt),
            ),
          ),
        ],
      ),
    );
  }
}

/// The picture of a sent receipt over the whole screen, to be pinched and
/// moved about. Signed for an hour, then forgotten.
class ReceiptImageViewer extends ConsumerWidget {
  final ReceiptModel receipt;

  const ReceiptImageViewer({super.key, required this.receipt});

  static Future<void> open(BuildContext context, ReceiptModel receipt) => Navigator.of(context).push(
      MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => ReceiptImageViewer(receipt: receipt)));

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final text = context.text;
    final photo = receiptPhoto(receipt);
    final link = ref.watch(signedPhotoProvider(photo));
    final url = link.valueOrNull;

    Widget message(String words, {VoidCallback? onRetry}) => Padding(
          padding: const EdgeInsetsDirectional.all(BasakSpace.gutter),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LucideIcons.triangleAlert, size: 28, color: colors.onInk),
              const SizedBox(height: BasakSpace.s10),
              Text(words, textAlign: TextAlign.center, style: text.body.copyWith(color: colors.onInk)),
              if (onRetry != null) ...[
                const SizedBox(height: BasakSpace.s12),
                InkOutlineButton(label: 'إعادة المحاولة', onPressed: onRetry),
              ],
            ],
          ),
        );

    final Widget body;
    if (url != null) {
      body = InteractiveViewer(
        key: const Key('receipt-image-viewer'),
        minScale: 1,
        maxScale: 5,
        child: SizedBox.expand(
          child: Image(
            image: avatarImage(url),
            fit: BoxFit.contain,
            semanticLabel: 'صورة الإيصال',
            loadingBuilder: (context, child, progress) => progress == null
                ? child
                : Center(child: CircularProgressIndicator(color: colors.onInk, strokeWidth: 2)),
            errorBuilder: (context, _, __) => Center(
              child: message('تعذّر تحميل صورة الإيصال. تأكد من الاتصال ثم حاول مرة أخرى.',
                  onRetry: () => ref.invalidate(signedPhotoProvider(photo))),
            ),
          ),
        ),
      );
    } else if (link.hasError || (link.hasValue && url == null)) {
      body = Center(
        child: message('تعذّر تحميل صورة الإيصال.', onRetry: () => ref.invalidate(signedPhotoProvider(photo))),
      );
    } else {
      body = Center(child: CircularProgressIndicator(color: colors.onInk, strokeWidth: 2));
    }

    return Scaffold(
      backgroundColor: colors.ink,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(BasakSpace.s8, BasakSpace.s4, BasakSpace.gutter, 0),
              child: Row(
                children: [
                  IconButton(
                    key: const Key('receipt-image-close'),
                    tooltip: 'إغلاق',
                    icon: Icon(LucideIcons.x, color: colors.onInk),
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                  const SizedBox(width: BasakSpace.s4),
                  Expanded(
                    child: Text('الإيصال المرفوع',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: text.headline.copyWith(color: colors.onInk)),
                  ),
                  StatusChip(receiptPill(receipt).status, label: receiptPill(receipt).label, onInk: true),
                ],
              ),
            ),
            Expanded(child: body),
          ],
        ),
      ),
    );
  }
}
