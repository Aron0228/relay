import 'package:flutter/material.dart';
import '../../session_service.dart';
import '../../widgets/app_dropdown.dart';
import '../execution/run_detail.dart';
import 'workspace_api.dart';

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

  Widget _filter(
    String label,
    String value,
    List<String> options,
    ValueChanged<String> update,
  ) => AppDropdown<String>(
    initialValue: value,
    decoration: InputDecoration(labelText: label),
    items: options
        .map(
          (item) => DropdownMenuItem(
            value: item,
            child: Text(
              item.isEmpty
                  ? 'All'
                  : item == 'stale'
                  ? 'Needs rechecking'
                  : item,
            ),
          ),
        )
        .toList(),
    onChanged: (value) {
      update(value!);
      _load();
    },
  );

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const SizedBox(height: 24),
      Text(
        'Environment knowledge',
        style: Theme.of(context).textTheme.titleMedium,
      ),
      const SizedBox(height: 8),
      const Text(
        'Observations saved by previous runs. They may need checking as the site changes.',
      ),
      const SizedBox(height: 24),
      AppDropdown<String>(
        key: ValueKey(_environment),
        initialValue: _environment,
        decoration: const InputDecoration(labelText: 'Environment'),
        items: widget.environments
            .map(
              (item) => DropdownMenuItem(
                value: item['id'] as String,
                child: Text(item['name'] as String),
              ),
            )
            .toList(),
        onChanged: (value) {
          setState(() => _environment = value);
          _load();
        },
      ),
      const SizedBox(height: 16),
      TextField(
        controller: _search,
        maxLength: 500,
        decoration: const InputDecoration(labelText: 'Search knowledge'),
        onSubmitted: (_) => _load(),
      ),
      const SizedBox(height: 16),
      _filter('Type', _type, [
        '',
        'navigation',
        'workflow',
        'precondition',
        'behavior',
      ], (value) => _type = value),
      const SizedBox(height: 16),
      _filter('Status', _status, [
        '',
        'unverified',
        'verified',
        'retired',
        'stale',
      ], (value) => _status = value),
      const SizedBox(height: 16),
      Align(
        alignment: Alignment.centerRight,
        child: OutlinedButton(
          onPressed: _busy || _environment == null ? null : _load,
          child: const Text('Refresh'),
        ),
      ),
      if (_busy) const LinearProgressIndicator(),
      if (_error != null) Text(_error!),
      if (!_busy && _records.isEmpty)
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Text('No knowledge matches these filters.'),
        ),
      for (final record in _records)
        Card(
          child: ExpansionTile(
            title: Text(record['title'] as String),
            subtitle: Text(
              '${record['type']} · ${record['verificationStatus']} · Confidence ${((record['confidence'] as num) * 100).round()}%',
            ),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            childrenPadding: const EdgeInsets.all(16),
            children: [
              SelectableText(record['content'] as String),
              const SizedBox(height: 16),
              Text('${record['scopeOrigin']} · Version ${record['version']}'),
              Text(
                'Last independently checked: ${record['lastVerifiedAt'] ?? 'Not yet checked'}',
              ),
              TextButton(
                onPressed: () => _source(record['sourceRunId'] as String),
                child: const Text('View source run and observations'),
              ),
              ExpansionTile(
                title: const Text('Source observation IDs'),
                children: [
                  for (final id in record['sourceEventIds'] as List)
                    SelectableText('$id'),
                ],
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () => _showSources(record['id'] as String),
                child: const Text('Show source observations'),
              ),
              for (final source
                  in _sources[record['id']] ?? <Map<String, dynamic>>[])
                ExpansionTile(
                  title: Text(source['id'] as String),
                  children: [
                    SelectableText(source['payload']['observation'] as String),
                  ],
                ),
              Text(
                'Changes and proposals',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              for (final patch in _patches.where(
                (patch) => patch['knowledgeId'] == record['id'],
              )) ...[
                const Divider(),
                Text('${patch['operation']} · ${patch['status']}'),
                Text('${patch['createdAt']}'),
                const SizedBox(height: 8),
                Text(patch['reason'] as String),
                if (patch['operation'] == 'update' && patch['previous'] != null)
                  Text('Previous: ${patch['previous']['content']}'),
                Text(patch['proposal']['content'] as String),
                TextButton(
                  onPressed: () => _source(patch['sourceRunId'] as String),
                  child: const Text('View evidence run'),
                ),
                if (patch['status'] == 'pending' && widget.admin)
                  Wrap(
                    spacing: 12,
                    children: [
                      OutlinedButton(
                        onPressed: _busy
                            ? null
                            : () => _decide(patch['id'] as String, true),
                        child: const Text('Accept change'),
                      ),
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => _decide(patch['id'] as String, false),
                        child: const Text('Reject'),
                      ),
                    ],
                  ),
              ],
            ],
          ),
        ),
      if (_records.isNotEmpty || _offset > 0)
        Wrap(
          spacing: 12,
          children: [
            OutlinedButton(
              onPressed: _offset == 0 || _busy
                  ? null
                  : () {
                      _offset -= 50;
                      _load(reset: false);
                    },
              child: const Text('Previous'),
            ),
            OutlinedButton(
              onPressed: _records.length < 50 || _busy
                  ? null
                  : () {
                      _offset += 50;
                      _load(reset: false);
                    },
              child: const Text('Next'),
            ),
          ],
        ),
    ],
  );
}
