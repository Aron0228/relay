import 'package:flutter/material.dart';
import '../../session_service.dart';
import '../workspace/workspace_api.dart';

class RunKnowledge extends StatefulWidget {
  const RunKnowledge({
    super.key,
    required this.sessions,
    required this.runId,
    required this.workspaceId,
  });
  final SessionService sessions;
  final String runId;
  final String workspaceId;

  @override
  State<RunKnowledge> createState() => _RunKnowledgeState();
}

class _RunKnowledgeState extends State<RunKnowledge> {
  late final _api = WorkspaceApi(widget.sessions);
  List<Map<String, dynamic>>? _items;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final items = await _api.list(
        '/workspaces/${widget.workspaceId}/runs/${widget.runId}/knowledge',
      );
      if (mounted) setState(() => _items = items);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not load the knowledge supplied to this run.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton(
          onPressed: _busy ? null : _load,
          child: Text(
            _busy ? 'Loading…' : 'Show knowledge supplied to this run',
          ),
        ),
        if (_error != null) Text(_error!),
        if (_items != null && _items!.isEmpty)
          const Text('No stored knowledge was supplied to this run.'),
        for (final item in _items ?? <Map<String, dynamic>>[])
          ExpansionTile(
            title: Text(
              '${item['snapshot']['title']} · Version ${item['version']}',
            ),
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SelectableText(item['snapshot']['content'] as String),
                    const SizedBox(height: 12),
                    Text(
                      '${item['snapshot']['verificationStatus']}${item['snapshot']['stale'] == true ? ' · May be outdated' : ''} · Retrieved ${item['createdAt']}',
                    ),
                  ],
                ),
              ),
            ],
          ),
      ],
    ),
  );
}
