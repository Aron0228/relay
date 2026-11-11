import 'package:flutter/material.dart';

abstract final class AppSpacing {
  static const double label = 8;
  static const double control = 12;
  static const double group = 16;
  static const double section = 24;
}

class AppStack extends StatelessWidget {
  const AppStack({
    super.key,
    required this.children,
    this.gap = AppSpacing.section,
  });
  final List<Widget> children;
  final double gap;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (var index = 0; index < children.length; index++) ...[
        if (index > 0) SizedBox(height: gap),
        children[index],
      ],
    ],
  );
}

class AppSectionHeading extends StatelessWidget {
  const AppSectionHeading({
    super.key,
    required this.title,
    this.description,
    this.actions,
  });
  final String title;
  final String? description;
  final Widget? actions;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final heading = AppStack(
        gap: AppSpacing.label,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          if (description != null) Text(description!),
        ],
      );

      if (actions == null) return heading;
      if (constraints.maxWidth < 600) {
        return AppStack(
          gap: AppSpacing.group,
          children: [
            heading,
            Align(alignment: Alignment.centerRight, child: actions!),
          ],
        );
      }

      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: heading),
          const SizedBox(width: AppSpacing.group),
          actions!,
        ],
      );
    },
  );
}

class AppActions extends StatelessWidget {
  const AppActions({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: AppSpacing.control,
    runSpacing: AppSpacing.control,
    crossAxisAlignment: WrapCrossAlignment.center,
    children: children,
  );
}

class AppFilterBar extends StatelessWidget {
  const AppFilterBar({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) =>
      AppStack(gap: AppSpacing.group, children: children);
}
