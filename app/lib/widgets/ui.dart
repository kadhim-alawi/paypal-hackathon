import 'package:flutter/material.dart';

import '../core/format.dart';
import '../theme.dart';

/// Centers content with a readable max width and the standard side gutter.
class MaxWidth extends StatelessWidget {
  const MaxWidth({super.key, required this.child, this.width = 1120, this.padding = const EdgeInsets.symmetric(horizontal: 16)});
  final Widget child;
  final double width;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: width),
          child: Padding(padding: padding, child: child),
        ),
      );
}

class TideoverLogo extends StatelessWidget {
  const TideoverLogo({super.key, this.size = 30, this.wordmark = true, this.color = T.teal, this.onDark = false});
  final double size;
  final bool wordmark;
  final Color color;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final mark = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(size * 0.3)),
      child: CustomPaint(painter: _WavePainter()),
    );
    if (!wordmark) return mark;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      mark,
      SizedBox(width: size * 0.32),
      Text(
        'Tideover',
        style: TextStyle(
          fontFamily: 'InterDisplay',
          fontWeight: FontWeight.w800,
          fontSize: size * 0.68,
          letterSpacing: -0.4,
          color: onDark ? Colors.white : T.ink,
        ),
      ),
    ]);
  }
}

class _WavePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.085
      ..strokeCap = StrokeCap.round;
    for (final dy in [0.40, 0.60]) {
      final y = size.height * dy;
      final p = Path()..moveTo(size.width * 0.22, y);
      p.cubicTo(size.width * 0.36, y - size.height * 0.12, size.width * 0.50, y + size.height * 0.12, size.width * 0.64, y);
      p.quadraticBezierTo(size.width * 0.71, y - size.height * 0.06, size.width * 0.78, y);
      canvas.drawPath(p, paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    this.title,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.color,
    this.subtitle,
  });
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Container(
      decoration: BoxDecoration(
        color: color ?? T.surface,
        borderRadius: T.r20,
        border: Border.all(color: T.line),
      ),
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (title != null) ...[
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title!, style: t.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
                  if (subtitle != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(subtitle!, style: t.bodySmall)),
                ]),
              ),
              ?trailing,
            ]),
            const SizedBox(height: 14),
          ],
          child,
        ],
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.caption, this.icon, this.accent = T.teal, this.highlight = false});
  final String label;
  final String value;
  final String? caption;
  final IconData? icon;
  final Color accent;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: highlight ? accent : T.surface,
        borderRadius: T.r20,
        border: Border.all(color: highlight ? accent : T.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: highlight ? Colors.white70 : accent),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(label,
                overflow: TextOverflow.ellipsis,
                style: t.labelMedium?.copyWith(color: highlight ? Colors.white70 : T.muted)),
          ),
        ]),
        const SizedBox(height: 8),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(value,
              style: t.headlineMedium?.copyWith(color: highlight ? Colors.white : T.ink, fontWeight: FontWeight.w800)),
        ),
        if (caption != null) ...[
          const SizedBox(height: 4),
          Text(caption!, style: t.bodySmall?.copyWith(color: highlight ? Colors.white70 : T.muted)),
        ],
      ]),
    );
  }
}

class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.color = T.muted, this.background, this.icon, this.dense = false});
  final String label;
  final Color color;
  final Color? background;
  final IconData? icon;
  final bool dense;

  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.symmetric(horizontal: dense ? 8 : 10, vertical: dense ? 3 : 5),
        decoration: BoxDecoration(color: background ?? color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(99)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: dense ? 12 : 14, color: color), const SizedBox(width: 4)],
          Text(label, style: TextStyle(fontFamily: 'Inter', fontSize: dense ? 11.5 : 12.5, fontWeight: FontWeight.w700, color: color)),
        ]),
      );
}

/// Status → label + color, shared by applicant and staff screens.
({String label, Color color, IconData icon}) statusStyle(String status) => switch (status) {
      'intake' => (label: 'Draft', color: T.muted, icon: Icons.edit_note_rounded),
      'submitted' => (label: 'AI review', color: T.info, icon: Icons.auto_awesome_rounded),
      'needs_info' => (label: 'Needs info', color: T.warn, icon: Icons.help_outline_rounded),
      'in_review' => (label: 'In review', color: T.info, icon: Icons.visibility_outlined),
      'approved' => (label: 'Approved', color: T.teal, icon: Icons.check_circle_outline_rounded),
      'awaiting_funds' => (label: 'Awaiting funds', color: T.warn, icon: Icons.hourglass_top_rounded),
      'paying' => (label: 'Sending', color: T.teal, icon: Icons.send_rounded),
      'paid' => (label: 'Paid', color: T.teal, icon: Icons.verified_rounded),
      'unclaimed' => (label: 'Unclaimed', color: T.warn, icon: Icons.mark_email_unread_outlined),
      'payout_failed' => (label: 'Payout failed', color: T.danger, icon: Icons.error_outline_rounded),
      'denied' => (label: 'Declined', color: T.danger, icon: Icons.block_rounded),
      'withdrawn' => (label: 'Withdrawn', color: T.muted, icon: Icons.undo_rounded),
      'success' => (label: 'Delivered', color: T.teal, icon: Icons.verified_rounded),
      'processing' || 'pending' => (label: 'Processing', color: T.info, icon: Icons.sync_rounded),
      'failed' || 'blocked' || 'returned' => (label: titleCase(status), color: T.danger, icon: Icons.error_outline_rounded),
      'captured' => (label: 'Received', color: T.teal, icon: Icons.check_circle_outline_rounded),
      'created' => (label: 'Started', color: T.muted, icon: Icons.schedule_rounded),
      'refunded' => (label: 'Refunded', color: T.warn, icon: Icons.undo_rounded),
      _ => (label: titleCase(status), color: T.muted, icon: Icons.circle_outlined),
    };

class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key, this.dense = false});
  final String status;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final s = statusStyle(status);
    return Pill(s.label, color: s.color, icon: s.icon, dense: dense);
  }
}

class AiRecommendationChip extends StatelessWidget {
  const AiRecommendationChip({super.key, required this.recommendation, this.confidence, this.dense = false});
  final String? recommendation;
  final double? confidence;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    if (recommendation == null) return Pill('AI pending', color: T.muted, icon: Icons.auto_awesome_outlined, dense: dense);
    final (label, color) = switch (recommendation) {
      'approve' => ('Approve', T.teal),
      'deny' => ('Decline', T.danger),
      _ => ('Ask more', T.warn),
    };
    final pct = confidence == null ? '' : ' · ${(confidence! * 100).round()}%';
    return Pill('AI: $label$pct', color: color, icon: Icons.auto_awesome_rounded, dense: dense);
  }
}

class RiskChip extends StatelessWidget {
  const RiskChip({super.key, required this.level, this.count = 0, this.dense = false});
  final String level;
  final int count;
  final bool dense;

  @override
  Widget build(BuildContext context) => switch (level) {
        'high' => Pill('High risk', color: T.danger, icon: Icons.gpp_bad_outlined, dense: dense),
        'medium' => Pill('$count flag${count == 1 ? '' : 's'}', color: T.warn, icon: Icons.flag_outlined, dense: dense),
        _ => Pill('Clean checks', color: T.teal, icon: Icons.shield_outlined, dense: dense),
      };
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});
  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 56,
          height: 56,
          decoration: const BoxDecoration(color: T.tealSoft, shape: BoxShape.circle),
          child: Icon(icon, color: T.tealDark),
        ),
        const SizedBox(height: 14),
        Text(title, style: t.titleMedium, textAlign: TextAlign.center),
        if (message != null) ...[
          const SizedBox(height: 6),
          Text(message!, style: t.bodyMedium?.copyWith(color: T.muted), textAlign: TextAlign.center),
        ],
        if (action != null) ...[const SizedBox(height: 16), action!],
      ]),
    );
  }
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 2.6)),
            if (label != null) ...[const SizedBox(height: 12), Text(label!, style: const TextStyle(color: T.muted))],
          ]),
        ),
      );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => EmptyState(
        icon: Icons.cloud_off_rounded,
        title: 'Something went wrong',
        message: '$error',
        action: onRetry == null ? null : OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
      );
}

void showSnack(BuildContext context, String message, {bool error = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? T.danger : T.ink,
    ));
}

/// Small "verified" mark used next to PayPal identities.
class VerifiedBadge extends StatelessWidget {
  const VerifiedBadge({super.key, this.label = 'Verified with PayPal'});
  final String label;

  @override
  Widget build(BuildContext context) => Pill(label, color: T.paypalLight, icon: Icons.verified_user_rounded, dense: true);
}

/// Thin strip that says when money or AI isn't real. Its height is fixed so
/// app bars can account for it.
class ModeBanner extends StatelessWidget {
  const ModeBanner({super.key});

  static const double height = 26;
  static String? text;

  /// Called once at startup with the server's modes.
  static void configure({required String paypalMode, required String aiMode}) {
    final parts = <String>[
      if (paypalMode == 'simulated') 'PayPal simulator · no real money',
      if (paypalMode == 'sandbox') 'PayPal sandbox · test money only',
      if (aiMode != 'claude') 'AI offline (rule-based)',
    ];
    text = parts.isEmpty ? null : parts.join(' · ');
  }

  static double get extent => text == null ? 0 : height;

  @override
  Widget build(BuildContext context) {
    final t = text;
    if (t == null) return const SizedBox.shrink();
    return Container(
      height: height,
      width: double.infinity,
      color: T.sunSoft,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Text(t,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontFamily: 'Inter', fontSize: 11.5, fontWeight: FontWeight.w600, color: Color(0xFF7A5300))),
    );
  }
}
