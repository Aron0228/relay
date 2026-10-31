import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../session_service.dart';
import '../../theme.dart';
import 'workspace_api.dart';
import 'workspace_side_panel.dart';

class WorkspaceGithubSettings extends StatefulWidget {
  const WorkspaceGithubSettings({
    super.key,
    required this.sessions,
    required this.workspaceId,
    required this.admin,
    this.api,
    this.openUrl,
  });
  final SessionService sessions;
  final String workspaceId;
  final bool admin;
  final WorkspaceApi? api;
  final Future<bool> Function(Uri)? openUrl;

  @override
  State<WorkspaceGithubSettings> createState() =>
      _WorkspaceGithubSettingsState();
}

class _WorkspaceGithubSettingsState extends State<WorkspaceGithubSettings> {
  late final _api = widget.api ?? WorkspaceApi(widget.sessions);
  List<Map<String, dynamic>> _installations = [],
      _repositories = [],
      _environments = [];
  bool _busy = false;
  String? _error;
  String get _path => '/workspaces/${widget.workspaceId}/github';

  @override
  void initState() {
    super.initState();
    _perform(_load);
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _perform(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _load() async {
    final data = await _api.request('GET', _path) as Map<String, dynamic>;
    final environments = await _api.list(
      '/workspaces/${widget.workspaceId}/environments',
    );

    if (!mounted) return;

    setState(() {
      _installations = (data['installations'] as List)
          .cast<Map<String, dynamic>>();
      _repositories = (data['repositories'] as List)
          .cast<Map<String, dynamic>>();
      _environments = environments;
    });
  }

  Future<void> _openGithub([String? installationId]) async {
    await _perform(() async {
      final path = installationId == null
          ? '$_path/installation-url'
          : '$_path/installations/$installationId/settings-url';
      final data = await _api.request('GET', path) as Map<String, dynamic>;
      final url = Uri.parse(data['url'] as String);
      final opened =
          await (widget.openUrl?.call(url) ??
              launchUrl(url, mode: LaunchMode.externalApplication));

      if (!opened) {
        throw Exception('Could not open the GitHub installation page.');
      }
    });
  }

  Future<void> _connect() async {
    await _perform(() async {
      final available = await _api.list('$_path/available-installations');
      if (!mounted) return;

      final selected = await showWorkspaceSidePanel<int>(
        context: context,
        title: 'Connect GitHub installation',
        builder: (context) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Install the GitHub App on GitHub first. Personal account owners and organization owners can connect their installations.',
            ),
            const SizedBox(height: 24),
            if (available.isEmpty)
              const Text('No installation you can manage was found.'),
            for (final installation in available)
              ListTile(
                title: Text(installation['accountLogin'] as String),
                subtitle: Text('Installation #${installation['githubId']}'),
                trailing: const Icon(LucideIcons.chevronRight),
                onTap: () =>
                    Navigator.pop(context, installation['githubId'] as int),
              ),
          ],
        ),
      );

      if (selected == null) return;

      await _api.request('POST', '$_path/installations', {
        'githubId': selected,
      });
      await _load();
    });
  }

  Future<void> _repository([Map<String, dynamic>? repository]) async {
    final saved = await showWorkspaceSidePanel<bool>(
      context: context,
      title: 'Repository settings',
      builder: (context) => _RepositoryForm(
        api: _api,
        path: _path,
        installations: _installations,
        environments: _environments,
        repository: repository,
      ),
    );

    if (saved == true && mounted) await _perform(_load);
  }

  Future<void> _disconnect(String kind, String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Disconnect GitHub connection?'),
        content: const Text('Previous tasks and runs will be retained.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    await _perform(() async {
      await _api.request('DELETE', '$_path/$kind/$id');
      await _load();
    });
  }

  Widget _heading(String title, String description, Widget? action) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 24),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(
                description,
                style: const TextStyle(color: RelayTokens.muted, fontSize: 13),
              ),
            ],
          ),
        ),
        if (action != null) ...[const SizedBox(width: 12), action],
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_busy) const LinearProgressIndicator(),
      if (_error != null)
        Text(_error!, style: const TextStyle(color: RelayTokens.error)),
      _heading(
        'GitHub',
        'Connect repositories to an approved test environment.',
        widget.admin
            ? FilledButton(
                onPressed: _busy ? null : _connect,
                child: const Text('Connect'),
              )
            : null,
      ),
      if (widget.admin)
        Padding(
          padding: const EdgeInsets.only(bottom: 24),
          child: Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              OutlinedButton(
                onPressed: _busy ? null : () => _openGithub(),
                child: const Text('Install GitHub App'),
              ),
              OutlinedButton(
                onPressed: _busy ? null : () => _perform(_load),
                child: const Text('Refresh'),
              ),
            ],
          ),
        ),
      if (_installations.isEmpty)
        const Text('No GitHub installation connected.'),
      for (final installation in _installations)
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(installation['accountLogin'] as String),
              subtitle: Text('Installation #${installation['githubId']}'),
            ),
            if (widget.admin)
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => _openGithub(installation['id'] as String),
                    child: const Text('Manage on GitHub'),
                  ),
                  OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => _disconnect(
                            'installations',
                            installation['id'] as String,
                          ),
                    child: const Text('Disconnect'),
                  ),
                ],
              ),
            const SizedBox(height: 16),
          ],
        ),
      _heading(
        'Repositories',
        'Choose the environment used to test each repository.',
        widget.admin
            ? OutlinedButton(
                onPressed:
                    _busy || _installations.isEmpty || _environments.isEmpty
                    ? null
                    : () => _repository(),
                child: const Text('Add repository'),
              )
            : null,
      ),
      if (widget.admin && _environments.isEmpty)
        const Text('Create an environment in the Environments tab first.'),
      if (_repositories.isEmpty) const Text('No repository configured.'),
      for (final repository in _repositories)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(repository['fullName'] as String),
          subtitle: Text(
            _environments
                    .where(
                      (environment) =>
                          environment['id'] ==
                          repository['defaultEnvironmentId'],
                    )
                    .map((environment) => environment['name'] as String)
                    .firstOrNull ??
                'Environment unavailable',
          ),
          trailing: widget.admin
              ? PopupMenuButton<String>(
                  onSelected: (action) => action == 'edit'
                      ? _repository(repository)
                      : _disconnect('repositories', repository['id'] as String),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Edit')),
                    PopupMenuItem(value: 'remove', child: Text('Remove')),
                  ],
                )
              : null,
        ),
    ],
  );
}

class _RepositoryForm extends StatefulWidget {
  const _RepositoryForm({
    required this.api,
    required this.path,
    required this.installations,
    required this.environments,
    this.repository,
  });
  final WorkspaceApi api;
  final String path;
  final List<Map<String, dynamic>> installations, environments;
  final Map<String, dynamic>? repository;

  @override
  State<_RepositoryForm> createState() => _RepositoryFormState();
}

class _RepositoryFormState extends State<_RepositoryForm> {
  late String _installationId =
      widget.repository?['installationId'] as String? ??
      widget.installations.first['id'] as String;
  late int? _repositoryId = widget.repository?['githubId'] as int?;
  late String? _environmentId =
      widget.repository?['defaultEnvironmentId'] as String?;
  List<Map<String, dynamic>> _repositories = [];
  bool _busy = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _busy = true;
      _error = null;
      _repositories = [];
    });

    try {
      final items = await widget.api.list(
        '${widget.path}/installations/$_installationId/repositories',
      );
      if (mounted) {
        setState(() {
          _repositories = items;
          if (!items.any((item) => item['githubId'] == _repositoryId)) {
            _repositoryId = null;
          }
        });
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      await widget.api.request('POST', '${widget.path}/repositories', {
        'installationId': _installationId,
        'githubId': _repositoryId,
        'environmentId': _environmentId,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (_busy) const LinearProgressIndicator(),
      if (_error != null)
        Text(_error!, style: const TextStyle(color: RelayTokens.error)),
      DropdownButtonFormField<String>(
        initialValue: _installationId,
        decoration: const InputDecoration(labelText: 'Installation'),
        items: [
          for (final item in widget.installations)
            DropdownMenuItem(
              value: item['id'] as String,
              child: Text(item['accountLogin'] as String),
            ),
        ],
        onChanged: _busy
            ? null
            : (value) {
                setState(() {
                  _installationId = value!;
                  _repositoryId = null;
                });
                _load();
              },
      ),
      const SizedBox(height: 24),
      DropdownButtonFormField<int>(
        key: ValueKey('$_installationId-${_repositories.length}'),
        initialValue:
            _repositories.any((item) => item['githubId'] == _repositoryId)
            ? _repositoryId
            : null,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Repository'),
        items: [
          for (final item in _repositories)
            DropdownMenuItem(
              value: item['githubId'] as int,
              child: Text(
                item['fullName'] as String,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        onChanged: _busy
            ? null
            : (value) => setState(() => _repositoryId = value),
      ),
      const SizedBox(height: 24),
      DropdownButtonFormField<String>(
        initialValue:
            widget.environments.any((item) => item['id'] == _environmentId)
            ? _environmentId
            : null,
        isExpanded: true,
        decoration: const InputDecoration(labelText: 'Approved environment'),
        items: [
          for (final item in widget.environments)
            DropdownMenuItem(
              value: item['id'] as String,
              child: Text(
                '${item['name']} — ${item['baseUrl']}',
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        onChanged: _busy
            ? null
            : (value) => setState(() => _environmentId = value),
      ),
      const SizedBox(height: 24),
      Align(
        alignment: Alignment.centerRight,
        child: FilledButton(
          onPressed: _busy || _repositoryId == null || _environmentId == null
              ? null
              : _save,
          child: const Text('Save repository'),
        ),
      ),
    ],
  );
}
