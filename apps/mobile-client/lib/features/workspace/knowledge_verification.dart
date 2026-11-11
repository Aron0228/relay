import 'package:flutter/material.dart';
import '../../widgets/app_layout.dart';
import 'knowledge_evidence.dart';

class KnowledgeVerificationCard extends StatelessWidget {
  const KnowledgeVerificationCard({
    super.key,
    required this.verification,
    this.showPatchId = false,
    this.onViewRun,
    this.onShowObservations,
    this.evidence = const [],
  });
  final Map<String, dynamic> verification;
  final bool showPatchId;
  final VoidCallback? onViewRun;
  final VoidCallback? onShowObservations;
  final List<Map<String, dynamic>> evidence;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(AppSpacing.group),
      child: AppStack(
        gap: AppSpacing.control,
        children: [
          Text('${verification['result']} · ${verification['createdAt']}'),
          Text(
            'Confidence ${((verification['confidence'] as num) * 100).round()}%',
          ),
          Text(verification['reason'] as String),
          for (final url in verification['observedUrls'] as List)
            SelectableText('$url'),
          if (showPatchId) Text('Patch ${verification['patchId']}'),
          if (onViewRun != null || onShowObservations != null)
            AppActions(
              children: [
                if (onViewRun != null)
                  TextButton(
                    onPressed: onViewRun,
                    child: const Text('View checking run'),
                  ),
                if (onShowObservations != null)
                  TextButton(
                    onPressed: onShowObservations,
                    child: const Text('Show observations'),
                  ),
              ],
            ),
          if (evidence.isNotEmpty) KnowledgeEvidenceList(sources: evidence),
        ],
      ),
    ),
  );
}
