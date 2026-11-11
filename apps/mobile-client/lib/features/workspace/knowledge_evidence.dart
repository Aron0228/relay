import 'package:flutter/material.dart';
import '../../widgets/app_disclosure.dart';
import '../../widgets/app_layout.dart';

class KnowledgeEvidenceList extends StatelessWidget {
  const KnowledgeEvidenceList({super.key, required this.sources});
  final List<Map<String, dynamic>> sources;

  @override
  Widget build(BuildContext context) => AppStack(
    gap: AppSpacing.control,
    children: [
      for (final source in sources)
        AppDisclosure(
          title: source['id'] as String,
          children: [
            SelectableText(source['payload']['observation'] as String),
          ],
        ),
    ],
  );
}
