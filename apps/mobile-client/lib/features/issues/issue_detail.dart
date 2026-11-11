import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../session_service.dart';
import '../../theme.dart';
import '../../widgets/markdown_content.dart';
import '../workspace/workspace_api.dart';
import '../execution/run_detail.dart';
import '../execution/run_status.dart';
import 'issue_status.dart';

class IssueDetailPage extends StatefulWidget {
  const IssueDetailPage({
    super.key,
    required this.sessions,
    required this.id,
    this.pullRequests = false,
  });
  final SessionService sessions;
  final String id;
  final bool pullRequests;

  @override
  State<IssueDetailPage> createState() => _IssueDetailPageState();
}

class _IssueDetailPageState extends State<IssueDetailPage> {
  late final _api = WorkspaceApi(widget.sessions);
  Map<String, dynamic>? _issue;
  String? _taskId;
  String? _error;
  String _tab = 'Overview';
  bool _stopping = false;
  Timer? _timer;
  int _revision = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _revision++;
    _timer?.cancel();
    _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    final revision = ++_revision;
    _timer?.cancel();
    try {
      final query = _taskId == null
          ? ''
          : '?${Uri(queryParameters: {'taskId': _taskId}).query}';
      final issue =
          await _api.request(
                'GET',
                '/${widget.pullRequests ? 'pull-requests' : 'issues'}/${widget.id}$query',
              )
              as Map<String, dynamic>;
      if (!mounted || revision != _revision) return;
      setState(() {
        _issue = issue;
        _error = null;
      });
    } catch (_) {
      if (mounted && revision == _revision) {
        setState(
          () => _error =
              'Could not load this issue or you no longer have access.',
        );
      }
    } finally {
      if (mounted && revision == _revision) {
        _timer = Timer(const Duration(seconds: 3), _load);
      }
    }
  }

  Future<void> _cancel() async {
    setState(() => _stopping = true);
    try {
      await _api.request('POST', '/tasks/${_issue!['task']['id']}/cancel');
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not stop the investigation.');
    } finally {
      if (mounted) setState(() => _stopping = false);
    }
  }

  Widget _section(String title, Widget child) => Padding(
    padding: const EdgeInsets.only(top: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 10),
        child,
      ],
    ),
  );

  String _dateLabel(String value) {
    final date = DateTime.parse(value).toLocal();
    final localization = MaterialLocalizations.of(context);
    return '${localization.formatMediumDate(date)} · ${localization.formatTimeOfDay(TimeOfDay.fromDateTime(date))}';
  }

  Widget _runGroup(Map<String, dynamic> group) {
    final investigation = group['investigation'] as Map<String, dynamic>;
    final runs = group['runs'] as List;

    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _dateLabel(investigation['createdAt'] as String),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: RelayTokens.muted,
                  ),
                ),
              ),
              TextButton(
                onPressed: () {
                  setState(() {
                    _taskId = investigation['id'] as String;
                    _tab = 'Overview';
                  });
                  _load();
                },
                child: const Text('View result'),
              ),
            ],
          ),
          for (final run in runs)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(9),
                clipBehavior: Clip.antiAlias,
                child: ListTile(
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(9),
                  ),
                  hoverColor: RelayTokens.background,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 5,
                  ),
                  title: Text(
                    run['title'] as String,
                    style: const TextStyle(fontSize: 14),
                  ),
                  subtitle: Text(
                    issueOutcomeLabel(run['result']?['verdict'] as String?),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      RunStatusBadge(status: run['status'] as String),
                      const Icon(LucideIcons.chevronRight, size: 16),
                    ],
                  ),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => RunDetailPage(
                          sessions: widget.sessions,
                          id: run['id'] as String,
                          liveView: false,
                        ),
                      ),
                    );
                    if (mounted) _load();
                  },
                ),
              ),
            ),
          if (runs.isEmpty) const Text('No stage runs yet.'),
        ],
      ),
    );
  }

  Widget _contextContent(Map<String, dynamic>? contextData) {
    if (contextData == null) {
      return const Text('Waiting for context collection.');
    }

    final data = contextData['data'] as Map<String, dynamic>?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Context: ${contextData['status']}'),
        SelectableText('Captured head: ${contextData['headSha']}'),
        if (contextData['model'] != null)
          Text('${contextData['model']} · ${contextData['promptVersion']}'),
        if (contextData['error'] != null)
          Text(
            contextData['error'] as String,
            style: const TextStyle(color: RelayTokens.error),
          ),
        if (data != null) ...[
          _section('Test objective', Text(data['summary'] as String)),
          for (final field in [
            ('affectedSurfaces', 'Affected surfaces'),
            ('preconditions', 'Preconditions'),
            ('steps', 'Planned checks'),
            ('uncertainties', 'Uncertainties'),
          ])
            _section(
              field.$2,
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final value in data[field.$1] as List)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(value.toString()),
                    ),
                  if ((data[field.$1] as List).isEmpty)
                    const Text('None reported.'),
                ],
              ),
            ),
          _section(
            'Expected behavior',
            Text(data['expectedBehavior'] as String),
          ),
        ],
        _section(
          'Captured sources',
          Column(
            children: [
              for (final source in contextData['sources'] as List)
                ExpansionTile(
                  title: Text(
                    '${source['kind']} · ${source['id']}${source['truncated'] == true ? ' · Truncated' : ''}',
                  ),
                  children: [
                    TextButton(
                      onPressed: () async {
                        final uri = Uri.parse(source['url'] as String);
                        if (['https', 'http'].contains(uri.scheme)) {
                          await launchUrl(
                            uri,
                            mode: LaunchMode.externalApplication,
                          );
                        }
                      },
                      child: const Text('View source on GitHub'),
                    ),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 320),
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(12),
                        child: SelectableText(
                          source['content'] as String,
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final issue = _issue;
    final task = issue?['task'] as Map<String, dynamic>?;
    final result = task?['result'] as Map<String, dynamic>?;
    final steps = result?['steps'] as List? ?? [];
    final preconditions = result?['preconditions'] as List? ?? [];

    return Scaffold(
      backgroundColor: RelayTokens.content,
      appBar: AppBar(
        title: Text(
          issue == null
              ? 'Issue'
              : '${widget.pullRequests ? 'Pull request' : 'Issue'} #${issue['number']}',
        ),
        backgroundColor: RelayTokens.content,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_error != null)
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _error!,
                        style: const TextStyle(color: RelayTokens.error),
                      ),
                    ),
                    TextButton(onPressed: _load, child: const Text('Retry')),
                  ],
                ),
              if (issue == null && _error == null)
                const Center(child: CircularProgressIndicator()),
              if (issue != null && task != null) ...[
                Text(
                  issue['repository'] as String,
                  style: const TextStyle(color: RelayTokens.muted),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 12,
                  runSpacing: 10,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    IssueStatusBadge(
                      status: task['status'] as String,
                      outcome: task['outcome'] as String?,
                    ),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size(0, 40),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 10,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      onPressed: () async {
                        if (!await launchUrl(
                              Uri.parse(issue['url'] as String),
                              mode: LaunchMode.externalApplication,
                            ) &&
                            mounted) {
                          setState(() => _error = 'Could not open GitHub.');
                        }
                      },
                      icon: const Icon(LucideIcons.externalLink, size: 16),
                      label: const Text('View on GitHub'),
                    ),
                    if (task['endedAt'] == null)
                      OutlinedButton(
                        onPressed: _stopping ? null : _cancel,
                        child: Text(
                          _stopping ? 'Stopping…' : 'Stop investigation',
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    for (final tab in [
                      'Overview',
                      if (widget.pullRequests) 'Context',
                      'Runs',
                    ])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            backgroundColor: _tab == tab
                                ? RelayTokens.selected
                                : RelayTokens.surface,
                            foregroundColor: _tab == tab
                                ? RelayTokens.text
                                : RelayTokens.muted,
                          ),
                          onPressed: () => setState(() => _tab = tab),
                          child: Text(tab),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    color: RelayTokens.surface,
                    border: Border.all(color: RelayTokens.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_tab == 'Overview') ...[
                        if (widget.pullRequests) ...[
                          SelectableText('Environment: ${issue['targetUrl']}'),
                          const SizedBox(height: 8),
                          SelectableText('Captured head: ${issue['headSha']}'),
                          const SizedBox(height: 20),
                        ],
                        Text(
                          issue['title'] as String,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w600,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 20),
                        MarkdownContent(
                          content: (issue['description'] as String).isEmpty
                              ? 'No description provided.'
                              : issue['description'] as String,
                          baseUrl: issue['url'] as String,
                        ),
                        _section(
                          'Verdict',
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                task['outcome'] == null
                                    ? 'Investigation in progress'
                                    : issueOutcomeLabel(
                                        task['outcome'] as String,
                                      ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                (result?['summary'] ??
                                        'Waiting for the next stage.')
                                    .toString(),
                              ),
                            ],
                          ),
                        ),
                        if (preconditions.isNotEmpty)
                          _section(
                            'Preconditions',
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (final condition in preconditions)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Text(condition.toString()),
                                  ),
                              ],
                            ),
                          ),
                        if (steps.isNotEmpty)
                          _section(
                            'Checked steps',
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (
                                  var index = 0;
                                  index < steps.length;
                                  index++
                                )
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Text(
                                      '${index + 1}. ${steps[index]['action']}',
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        if (result?['expectedBehavior'] != null)
                          _section(
                            'Expected behavior',
                            Text(result!['expectedBehavior'].toString()),
                          ),
                        if (result?['actualBehavior'] != null)
                          _section(
                            'Actual behavior',
                            Text(result!['actualBehavior'].toString()),
                          ),
                      ] else if (_tab == 'Context') ...[
                        _contextContent(
                          issue['context'] as Map<String, dynamic>?,
                        ),
                      ] else ...[
                        for (final group in issue['runGroups'] as List)
                          _runGroup(group as Map<String, dynamic>),
                        if ((issue['runGroups'] as List).isEmpty)
                          const Text('No runs yet.'),
                      ],
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
