import 'package:flutter/material.dart';
import 'app_layout.dart';

class AppDisclosure extends StatelessWidget {
  const AppDisclosure({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.onExpansionChanged,
  });
  final String title;
  final String? subtitle;
  final List<Widget> children;
  final ValueChanged<bool>? onExpansionChanged;

  @override
  Widget build(BuildContext context) => Card(
    child: ExpansionTile(
      title: Text(title),
      subtitle: subtitle == null ? null : Text(subtitle!),
      onExpansionChanged: onExpansionChanged,
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      childrenPadding: const EdgeInsets.all(AppSpacing.group),
      children: [AppStack(gap: AppSpacing.group, children: children)],
    ),
  );
}
