import 'package:flutter/material.dart';
import '../../theme.dart';

class RunStatusBadge extends StatelessWidget {
  const RunStatusBadge({super.key, required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final labels = {
      'queued': 'Queued',
      'running': 'In progress',
      'completed': 'Completed',
      'failed': 'Failed',
      'cancelled': 'Cancelled',
    };
    final color = status == 'running'
        ? RelayTokens.primaryHover
        : status == 'failed'
        ? RelayTokens.error
        : RelayTokens.muted;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: status == 'running' ? RelayTokens.selected : RelayTokens.surface,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        labels[status] ?? status,
        style: TextStyle(color: color, fontSize: 11),
      ),
    );
  }
}
