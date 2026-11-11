import '../../widgets/app_layout.dart';
import '../../widgets/app_disclosure.dart';
import '../workspace/knowledge_verification.dart';
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
  List<Map<String, dynamic>> _patches = [], _verifications = [];
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
      final path = '/workspaces/${widget.workspaceId}/runs/${widget.runId}';
      final results = await Future.wait([
        _api.list('$path/knowledge'),
        _api.request('GET', '$path/knowledge-patches'),
      ]);
      final patchData = results[1] as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _items = results[0] as List<Map<String, dynamic>>;
          _patches = (patchData['patches'] as List)
              .cast<Map<String, dynamic>>();
          _verifications = (patchData['verifications'] as List)
              .cast<Map<String, dynamic>>();
        });
      }
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
    padding: const EdgeInsets.only(top: AppSpacing.section),
    child: AppStack(
      children: [
        AppActions(
          children: [
            OutlinedButton(
              onPressed: _busy ? null : _load,
              child: Text(
                _busy ? 'Loading…' : 'Show knowledge supplied to this run',
              ),
            ),
          ],
        ),
        if (_error != null) Text(_error!),
        if (_items != null && _items!.isEmpty)
          const Text('No stored knowledge was supplied to this run.'),
        for (final item in _items ?? <Map<String, dynamic>>[])
          AppDisclosure(
            title: '${item['snapshot']['title']} · Version ${item['version']}',
            children: [
              SelectableText(item['snapshot']['content'] as String),
              Text(
                '${item['snapshot']['referenceOnly'] == true ? 'Reference from another environment or origin · ' : ''}${item['snapshot']['verificationStatus']}${item['snapshot']['stale'] == true ? ' · May be outdated' : ''} · Retrieved ${item['createdAt']}',
              ),
            ],
          ),
        if (_items != null) ...[
          Text(
            'Candidate patches supplied',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          for (final patch in _patches)
            AppDisclosure(
              title:
                  '${patch['snapshot']['proposal']['title']} · ${patch['snapshot']['scopePath']}',
              children: [
                SelectableText(
                  patch['snapshot']['proposal']['content'] as String,
                ),
              ],
            ),
          if (_patches.isEmpty)
            const Text('No candidate patches were supplied.'),
          Text(
            'Patch checks from this run',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          for (final check in _verifications)
            KnowledgeVerificationCard(verification: check, showPatchId: true),
          if (_verifications.isEmpty)
            const Text('No patch checks were reported.'),
        ],
      ],
    ),
  );
}
