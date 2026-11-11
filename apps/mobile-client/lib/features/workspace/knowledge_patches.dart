import 'package:flutter/material.dart';
import '../../session_service.dart';
import '../../widgets/app_layout.dart';
import '../../widgets/app_choice_field.dart';
import '../../widgets/app_disclosure.dart';
import '../../widgets/app_pagination.dart';
import 'knowledge_change.dart';
import 'knowledge_evidence.dart';
import 'knowledge_verification.dart';
import '../execution/run_detail.dart';
import 'workspace_api.dart';

class KnowledgePatches extends StatefulWidget {
  const KnowledgePatches({
    super.key,
    required this.sessions,
    required this.workspaceId,
    required this.environmentId,
    required this.environments,
    required this.admin,
  });
  final SessionService sessions;
  final String workspaceId;
  final String environmentId;
  final List<Map<String, dynamic>> environments;
  final bool admin;

  @override
  State<KnowledgePatches> createState() => _KnowledgePatchesState();
}

class _KnowledgePatchesState extends State<KnowledgePatches> {
  late final _api = WorkspaceApi(widget.sessions);
  List<Map<String, dynamic>> _patches = [];
  final Map<String, Map<String, dynamic>> _details = {};
  final Map<String, List<Map<String, dynamic>>> _evidence = {};
  final Map<String, int> _historyOffsets = {};
  String _status = '', _result = '';
  String? _error;
  bool _busy = false;
  int _offset = 0, _generation = 0;
  String get _path =>
      '/workspaces/${widget.workspaceId}/environments/${widget.environmentId}/knowledge-patches';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant KnowledgePatches oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.workspaceId != widget.workspaceId ||
        oldWidget.environmentId != widget.environmentId) {
      _load();
    }
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _load({bool reset = true}) async {
    final generation = ++_generation;
    if (reset) _offset = 0;
    setState(() {
      _busy = true;
      _error = null;
      _details.clear();
      _evidence.clear();
      _historyOffsets.clear();
    });
    final query = Uri(
      queryParameters: {
        'offset': '$_offset',
        if (_status.isNotEmpty) 'status': _status,
        if (_result.isNotEmpty) 'result': _result,
      },
    ).query;

    try {
      final patches = await _api.list('$_path?$query');
      if (mounted && generation == _generation) {
        setState(() => _patches = patches);
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = 'Could not load knowledge patches.');
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  Future<void> _detail(String id) async {
    final generation = _generation;
    try {
      final detail =
          await _api.request(
                'GET',
                '$_path/$id?offset=${_historyOffsets[id] ?? 0}',
              )
              as Map<String, dynamic>;
      if (mounted && generation == _generation) {
        setState(() => _details[id] = detail);
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = 'Could not load patch history.');
      }
    }
  }

  Future<void> _showEvidence(String patchId, String id) async {
    final generation = _generation;
    try {
      final data =
          await _api.request('GET', '$_path/$patchId/verifications/$id')
              as Map<String, dynamic>;
      if (mounted && generation == _generation) {
        setState(
          () => _evidence[id] = (data['sources'] as List)
              .cast<Map<String, dynamic>>(),
        );
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => _error = 'Could not load verification observations.');
      }
    }
  }

  Future<void> _decide(String id, bool accept) async {
    setState(() => _busy = true);
    try {
      final response =
          await _api.request('PATCH', '$_path/$id', {'accept': accept})
              as Map<String, dynamic>;
      await _load(reset: false);
      if (mounted && response['status'] == 'conflict') {
        setState(
          () => _error =
              'The knowledge changed since this proposal. A new proposal is needed.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not apply this decision. Confirmation and an unchanged base version are required.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _source(String id) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          RunDetailPage(sessions: widget.sessions, id: id, liveView: false),
    ),
  );
  String _environmentName(String? id) =>
      widget.environments.where((item) => item['id'] == id).firstOrNull?['name']
          as String? ??
      'Previous environment';

  Widget _history(Map<String, dynamic> patch) {
    final id = patch['id'] as String;
    final detail = _details[id];
    if (detail == null) return const Text('Loading history…');
    final checks = (detail['verifications'] as List)
        .cast<Map<String, dynamic>>();

    return AppStack(
      gap: AppSpacing.group,
      children: [
        AppDisclosure(
          title: 'Original observations',
          children: [
            KnowledgeEvidenceList(
              sources: (detail['sources'] as List).cast<Map<String, dynamic>>(),
            ),
          ],
        ),
        Text(
          'Verification history',
          style: Theme.of(context).textTheme.titleSmall,
        ),
        if (checks.isEmpty) const Text('No independent checks yet.'),
        for (final check in checks)
          KnowledgeVerificationCard(
            verification: check,
            onViewRun: () => _source(check['runId'] as String),
            onShowObservations: () => _showEvidence(id, check['id'] as String),
            evidence: _evidence[check['id']] ?? [],
          ),
        AppPagination(
          previousLabel: 'Newer checks',
          nextLabel: 'Older checks',
          hasPrevious: (_historyOffsets[id] ?? 0) > 0,
          hasNext: checks.length == 50,
          onChanged: (direction) {
            _historyOffsets[id] = (_historyOffsets[id] ?? 0) + direction * 50;
            _detail(id);
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => AppStack(
    children: [
      AppSectionHeading(
        title: 'Knowledge patches',
        description:
            'Proposed changes await observations from another run in the target environment. Preview proposals appear under the repository’s default environment.',
        actions: OutlinedButton(
          onPressed: _busy ? null : _load,
          child: const Text('Refresh'),
        ),
      ),
      AppFilterBar(
        children: [
          AppChoiceField(
            label: 'Application status',
            value: _status,
            options: const {
              '': 'All',
              'pending': 'Pending',
              'accepted': 'Applied / accepted',
              'rejected': 'Rejected',
              'conflict': 'Version conflict',
            },
            onChanged: (value) {
              _status = value;
              _load();
            },
          ),
          AppChoiceField(
            label: 'Latest check',
            value: _result,
            options: const {
              '': 'All',
              'unverified': 'Not yet checked',
              'confirmed': 'Confirmed',
              'contradicted': 'Contradicted',
              'inconclusive': 'Inconclusive',
            },
            onChanged: (value) {
              _result = value;
              _load();
            },
          ),
        ],
      ),
      if (_busy) const LinearProgressIndicator(),
      if (_error != null) Text(_error!),
      for (final patch in _patches)
        AppDisclosure(
          key: ValueKey('${patch['id']}-$_generation'),
          title: patch['proposal']['title'] as String,
          subtitle:
              '${patch['operation']} · ${patch['status']} · ${patch['latestVerification']?['result'] ?? 'Not yet checked'}',
          onExpansionChanged: (expanded) {
            if (expanded && !_details.containsKey(patch['id'])) {
              _detail(patch['id'] as String);
            }
          },
          children: [
            SelectableText('${patch['scopeOrigin']}${patch['scopePath']}'),
            KnowledgeChangeCard(
              patch: patch,
              showStatus: false,
              onViewRun: () => _source(patch['sourceRunId'] as String),
            ),
            Text(
              'From ${_environmentName(patch['sourceEnvironmentId'] as String?)} → ${_environmentName(patch['environmentId'] as String)}',
            ),
            SelectableText('Observed at ${patch['sourceUrl']}'),
            if (patch['baseVersion'] != null)
              Text('Based on version ${patch['baseVersion']}'),
            if (patch['appliedVerificationId'] != null)
              const Text(
                'Applied after independent confirmation in the target environment.',
              ),
            if (patch['status'] == 'pending')
              const Text(
                'A contradictory or inconclusive check keeps the proposal pending for a later run.',
              ),
            if (widget.admin && patch['status'] == 'pending')
              AppActions(
                children: [
                  OutlinedButton(
                    onPressed:
                        _busy ||
                            patch['latestVerification']?['result'] !=
                                'confirmed'
                        ? null
                        : () => _decide(patch['id'] as String, true),
                    child: const Text('Apply confirmed change'),
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => _decide(patch['id'] as String, false),
                    child: const Text('Reject proposal'),
                  ),
                ],
              ),
            _history(patch),
          ],
        ),
      if (!_busy && _patches.isEmpty)
        const Text('No patches match these filters.'),
      if (_patches.isNotEmpty || _offset > 0)
        AppPagination(
          hasPrevious: _offset > 0,
          hasNext: _patches.length == 50,
          busy: _busy,
          onChanged: (direction) {
            _offset += direction * 50;
            _load(reset: false);
          },
        ),
    ],
  );
}
