import 'package:flutter/material.dart';
import '../../session_service.dart';
import '../../widgets/app_layout.dart';
import '../../widgets/app_choice_field.dart';
import '../../widgets/app_disclosure.dart';
import '../../widgets/app_pagination.dart';
import 'knowledge_change.dart';
import 'knowledge_evidence.dart';
import '../../widgets/app_segmented_control.dart';
import '../execution/run_detail.dart';
import 'workspace_api.dart';
import 'knowledge_patches.dart';

class EnvironmentKnowledge extends StatefulWidget {
  const EnvironmentKnowledge({
    super.key,
    required this.sessions,
    required this.workspaceId,
    required this.environments,
    required this.admin,
  });
  final SessionService sessions;
  final String workspaceId;
  final List<Map<String, dynamic>> environments;
  final bool admin;

  @override
  State<EnvironmentKnowledge> createState() => _EnvironmentKnowledgeState();
}

class _EnvironmentKnowledgeState extends State<EnvironmentKnowledge> {
  late final _api = WorkspaceApi(widget.sessions);
  final _search = TextEditingController();
  String? _environment;
  String _type = '', _status = '';
  List<Map<String, dynamic>> _records = [], _patches = [];
  bool _busy = false;
  bool _showPatches = false;
  String? _error;
  final Map<String, List<Map<String, dynamic>>> _sources = {};
  int _generation = 0, _offset = 0;

  Future<void> _showSources(String id) async {
    try {
      final result =
          await _api.request(
                'GET',
                '/workspaces/${widget.workspaceId}/environments/$_environment/knowledge/$id',
              )
              as Map<String, dynamic>;
      if (mounted) {
        setState(
          () => _sources[id] = (result['sources'] as List)
              .cast<Map<String, dynamic>>(),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not load source observations.');
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _environment = widget.environments.firstOrNull?['id'] as String?;
    _load();
  }

  @override
  void didUpdateWidget(covariant EnvironmentKnowledge oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.workspaceId != widget.workspaceId ||
        !widget.environments.any((item) => item['id'] == _environment)) {
      _environment = widget.environments.firstOrNull?['id'] as String?;
      _load();
    }
  }

  @override
  void dispose() {
    _api.close();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = true}) async {
    final generation = ++_generation;
    if (_environment == null) return;
    if (reset) _offset = 0;
    setState(() {
      _busy = true;
      _error = null;
      _sources.clear();
    });
    final path = '/workspaces/${widget.workspaceId}/environments/$_environment';
    final query = Uri(
      queryParameters: {
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
        if (_type.isNotEmpty) 'type': _type,
        if (_status.isNotEmpty) 'status': _status,
        'offset': '$_offset',
      },
    ).query;

    try {
      final results = await Future.wait([
        _api.list('$path/knowledge?$query'),
        _api.list('$path/knowledge-patches'),
      ]);
      if (!mounted || generation != _generation) return;
      setState(() {
        _records = results[0];
        _patches = results[1];
      });
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = 'Could not load environment knowledge. Try again.',
        );
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  void _source(String id) => Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) =>
          RunDetailPage(sessions: widget.sessions, id: id, liveView: false),
    ),
  );

  Future<void> _decide(String id, bool accept) async {
    setState(() => _busy = true);
    try {
      await _api.request(
        'PATCH',
        '/workspaces/${widget.workspaceId}/environments/$_environment/knowledge-patches/$id',
        {'accept': accept},
      );
      await _load(reset: false);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not apply this change. Refresh to check its current version.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _record(Map<String, dynamic> record) => AppDisclosure(
    title: record['title'] as String,
    subtitle:
        '${record['type']} · ${record['verificationStatus']} · Confidence ${((record['confidence'] as num) * 100).round()}%',
    children: [
      SelectableText(record['content'] as String),
      Text(
        '${record['scopeOrigin']}${record['scopePath'] ?? '/'} · Version ${record['version']}',
      ),
      Text(
        'Last independently checked: ${record['lastVerifiedAt'] ?? 'Not yet checked'}',
      ),
      AppActions(
        children: [
          TextButton(
            onPressed: () => _source(record['sourceRunId'] as String),
            child: const Text('View source run and observations'),
          ),
        ],
      ),
      AppDisclosure(
        title: 'Source observation IDs',
        children: [
          for (final id in record['sourceEventIds'] as List)
            SelectableText('$id'),
        ],
      ),
      AppActions(
        children: [
          TextButton(
            onPressed: () => _showSources(record['id'] as String),
            child: const Text('Show source observations'),
          ),
        ],
      ),
      if (_sources[record['id']]?.isNotEmpty == true)
        KnowledgeEvidenceList(sources: _sources[record['id']]!),
      Text(
        'Changes and proposals',
        style: Theme.of(context).textTheme.titleSmall,
      ),
      for (final patch in _patches.where(
        (patch) => patch['knowledgeId'] == record['id'],
      ))
        KnowledgeChangeCard(
          patch: patch,
          sourceLabel: 'View evidence run',
          onViewRun: () => _source(patch['sourceRunId'] as String),
          actions: widget.admin && patch['status'] == 'pending'
              ? [
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
                    child: const Text('Reject'),
                  ),
                ]
              : [],
        ),
    ],
  );

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.section),
    child: AppStack(
      children: [
        const AppSectionHeading(
          title: 'Environment knowledge',
          description:
              'Observations saved by previous runs. They may need checking as the site changes.',
        ),
        AppFilterBar(
          children: [
            AppChoiceField(
              key: ValueKey(_environment),
              label: 'Environment',
              value: _environment,
              options: {
                for (final item in widget.environments)
                  item['id'] as String: item['name'] as String,
              },
              onChanged: (value) {
                setState(() => _environment = value);
                _load();
              },
            ),
            if (!_showPatches) ...[
              TextField(
                controller: _search,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'Search knowledge',
                ),
                onSubmitted: (_) => _load(),
              ),
              AppChoiceField(
                label: 'Type',
                value: _type,
                options: const {
                  '': 'All',
                  'navigation': 'navigation',
                  'workflow': 'workflow',
                  'precondition': 'precondition',
                  'behavior': 'behavior',
                },
                onChanged: (value) {
                  _type = value;
                  _load();
                },
              ),
              AppChoiceField(
                label: 'Status',
                value: _status,
                options: const {
                  '': 'All',
                  'unverified': 'unverified',
                  'verified': 'verified',
                  'retired': 'retired',
                  'stale': 'Needs rechecking',
                },
                onChanged: (value) {
                  _status = value;
                  _load();
                },
              ),
              AppActions(
                children: [
                  OutlinedButton(
                    onPressed: _busy || _environment == null ? null : _load,
                    child: const Text('Refresh'),
                  ),
                ],
              ),
            ],
          ],
        ),
        AppSegmentedControl(
          options: const {
            'knowledge': 'Active knowledge',
            'patches': 'Patches and checks',
          },
          selected: _showPatches ? 'patches' : 'knowledge',
          onChanged: (value) =>
              setState(() => _showPatches = value == 'patches'),
        ),
        if (_showPatches && _environment != null)
          KnowledgePatches(
            sessions: widget.sessions,
            workspaceId: widget.workspaceId,
            environmentId: _environment!,
            environments: widget.environments,
            admin: widget.admin,
          ),
        if (!_showPatches) ...[
          if (_busy) const LinearProgressIndicator(),
          if (_error != null) Text(_error!),
          if (!_busy && _records.isEmpty)
            const Text('No knowledge matches these filters.'),
          for (final record in _records) _record(record),
          if (_records.isNotEmpty || _offset > 0)
            AppPagination(
              hasPrevious: _offset > 0,
              hasNext: _records.length == 50,
              busy: _busy,
              onChanged: (direction) {
                _offset += direction * 50;
                _load(reset: false);
              },
            ),
        ],
      ],
    ),
  );
}
