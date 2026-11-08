import 'package:flutter/material.dart';
import '../../theme.dart';

class IssueStatusBadge extends StatelessWidget {
  const IssueStatusBadge({super.key, required this.status, this.outcome});
  final String status;
  final String? outcome;

  @override
  Widget build(BuildContext context) {
    final active = !['completed', 'failed', 'cancelled'].contains(status);
    final label = active
        ? status == 'running'
              ? 'In progress'
              : 'Queued'
        : status == 'cancelled'
        ? 'Cancelled'
        : outcome == 'fixed'
        ? 'Fixed'
        : outcome == 'not_fixed'
        ? 'Not fixed'
        : outcome == 'reproduced'
        ? 'Reproduced'
        : outcome == 'not_reproduced'
        ? 'Not reproduced'
        : 'Uncertain';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: ['fixed', 'reproduced'].contains(outcome)
            ? RelayTokens.selected
            : RelayTokens.surface,
        border: Border.all(color: RelayTokens.border),
        borderRadius: BorderRadius.circular(7),
      ),
      child: Text(label, style: const TextStyle(fontSize: 11)),
    );
  }
}

String issueOutcomeLabel(String? outcome) {
  return switch (outcome) {
    'fixed' => 'Fixed',
    'not_fixed' => 'Not fixed',
    'reproduced' => 'Reproduced',
    'not_reproduced' => 'Not reproduced',
    'inconclusive' => 'Uncertain',
    _ => outcome ?? 'Waiting for a result',
  };
}
