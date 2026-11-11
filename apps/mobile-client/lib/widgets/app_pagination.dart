import 'package:flutter/material.dart';
import 'app_layout.dart';

class AppPagination extends StatelessWidget {
  const AppPagination({
    super.key,
    required this.hasPrevious,
    required this.hasNext,
    required this.onChanged,
    this.busy = false,
    this.previousLabel = 'Previous',
    this.nextLabel = 'Next',
  });
  final bool hasPrevious;
  final bool hasNext;
  final bool busy;
  final ValueChanged<int> onChanged;
  final String previousLabel;
  final String nextLabel;

  @override
  Widget build(BuildContext context) => AppActions(
    children: [
      OutlinedButton(
        onPressed: busy || !hasPrevious ? null : () => onChanged(-1),
        child: Text(previousLabel),
      ),
      OutlinedButton(
        onPressed: busy || !hasNext ? null : () => onChanged(1),
        child: Text(nextLabel),
      ),
    ],
  );
}
