import 'package:flutter/material.dart';
import '../../widgets/app_layout.dart';

class KnowledgeChangeCard extends StatelessWidget {
  const KnowledgeChangeCard({
    super.key,
    required this.patch,
    required this.onViewRun,
    this.showStatus = true,
    this.sourceLabel = 'View source run',
    this.actions = const [],
  });
  final Map<String, dynamic> patch;
  final VoidCallback onViewRun;
  final bool showStatus;
  final String sourceLabel;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) => AppStack(
    gap: AppSpacing.control,
    children: [
      if (showStatus) Text('${patch['operation']} · ${patch['status']}'),
      Text('${patch['createdAt']}'),
      Text(patch['reason'] as String),
      if (patch['previous']?['content'] != null) ...[
        const Text('Current content at proposal time'),
        SelectableText(patch['previous']['content'] as String),
      ],
      const Text('Proposed change'),
      SelectableText(patch['proposal']['content'] as String),
      AppActions(
        children: [TextButton(onPressed: onViewRun, child: Text(sourceLabel))],
      ),
      if (actions.isNotEmpty) AppActions(children: actions),
    ],
  );
}
