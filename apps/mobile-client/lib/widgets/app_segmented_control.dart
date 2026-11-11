import 'package:flutter/material.dart';
import 'app_layout.dart';

class AppSegmentedControl extends StatelessWidget {
  const AppSegmentedControl({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
  });
  final Map<String, String> options;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => AppActions(
    children: [
      for (final option in options.entries)
        ChoiceChip(
          label: Text(option.value),
          selected: selected == option.key,
          onSelected: (_) => onChanged(option.key),
        ),
    ],
  );
}
