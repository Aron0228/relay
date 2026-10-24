import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../theme.dart';
import 'execution_api.dart';

class ActivityTimeline extends StatelessWidget {
  const ActivityTimeline({super.key, required this.events});
  final List<RunEvent> events;

  @override
  Widget build(BuildContext context) {
    final entries = events
        .where(
          (event) =>
              event.type == 'agent.activity' ||
              event.type == 'agent.summary' ||
              (event.type.startsWith('agent.tool_') &&
                  ![
                    'finish',
                    'reportProgress',
                  ].contains(event.payload['name'])),
        )
        .toList();

    if (entries.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'Activity will appear when the agent starts.',
          style: TextStyle(color: RelayTokens.muted),
        ),
      );
    }

    return Column(
      children: entries.map((event) {
        final p = event.payload;
        final tool = event.type.startsWith('agent.tool_');
        final message = event.type == 'agent.summary' || p['kind'] == 'message';
        final title = tool
            ? '${event.type == 'agent.tool_called'
                  ? 'Started'
                  : event.type == 'agent.tool_failed'
                  ? 'Failed'
                  : 'Completed'} · ${p['name']}'
            : message
            ? 'Relay'
            : 'Observation';
        final text = (p['text'] ?? '').toString();
        final details = (p['arguments'] ?? p['output'] ?? '').toString();

        return Container(
          width: double.infinity,
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: message ? RelayTokens.surface : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            border: message ? Border.all(color: RelayTokens.border) : null,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    tool ? LucideIcons.wrench : LucideIcons.sparkles,
                    size: 14,
                    color: RelayTokens.muted,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontSize: 12,
                        color: RelayTokens.muted,
                      ),
                    ),
                  ),
                ],
              ),
              if (text.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: SelectableText(
                    text,
                    style: TextStyle(
                      fontSize: 13,
                      height: 1.6,
                      color: message ? RelayTokens.text : RelayTokens.muted,
                    ),
                  ),
                ),
              if (tool && details.isNotEmpty)
                ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('Details', style: TextStyle(fontSize: 11)),
                  children: [
                    SelectableText(
                      details,
                      style: const TextStyle(
                        fontSize: 11,
                        color: RelayTokens.muted,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
