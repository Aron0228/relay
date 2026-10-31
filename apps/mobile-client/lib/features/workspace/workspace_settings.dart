import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../session_service.dart';
import 'workspace_api.dart';
import 'workspace_github_settings.dart';
import 'workspace_side_panel.dart';
import 'workspace_image_field.dart';
import 'workspace_avatar.dart';
import '../../theme.dart';

class WorkspaceSettings extends StatefulWidget {
  const WorkspaceSettings({
    super.key,
    required this.sessions,
    required this.workspace,
    required this.onChanged,
    this.api,
  });
  final WorkspaceApi? api;
  final SessionService sessions;
  final Map<String, dynamic>? workspace;
  final Future<void> Function() onChanged;

  @override
  State<WorkspaceSettings> createState() => _WorkspaceSettingsState();
}

class _WorkspaceSettingsState extends State<WorkspaceSettings> {
  late final _name = TextEditingController(
    text: widget.workspace?['name'] as String? ?? '',
  );
  final _detailsForm = GlobalKey<FormState>();
  late final _api = widget.api ?? WorkspaceApi(widget.sessions);
  List<Map<String, dynamic>> _members = [], _sent = [], _environments = [];
  bool _busy = false;
  int _tab = 0;
  String? _error;
  bool get _owner => widget.workspace?['isOwner'] == true;
  bool get _admin => widget.workspace?['role'] == 'admin';
  String get _path => '/workspaces/${widget.workspace!['id']}';

  @override
  void initState() {
    super.initState();
    _perform(_load);
  }

  @override
  void dispose() {
    _name.dispose();
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
    final members = widget.workspace == null
        ? <Map<String, dynamic>>[]
        : await _api.list('$_path/members');
    final environments = widget.workspace == null
        ? <Map<String, dynamic>>[]
        : await _api.list('$_path/environments');
    final sent = _admin
        ? await _api.list('$_path/invitations')
        : <Map<String, dynamic>>[];

    if (mounted) {
      setState(() {
        _members = members;
        _environments = environments;
        _sent = sent;
      });
    }
  }

  Future<Map<String, String>?> _form(
    String title,
    Map<String, String> fields,
  ) async {
    final controllers = fields.map(
      (key, value) => MapEntry(key, TextEditingController(text: value)),
    );
    final formKey = GlobalKey<FormState>();
    final result = await showWorkspaceSidePanel<Map<String, String>>(
      context: context,
      title: title,
      builder: (context) => Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final field in controllers.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: TextFormField(
                  controller: field.value,
                  decoration: InputDecoration(
                    labelText: field.key,
                    suffixIcon: field.key == 'E-mail'
                        ? const Tooltip(
                            message:
                                'Use an email address verified on your GitHub account.',
                            child: Icon(LucideIcons.info, size: 18),
                          )
                        : null,
                  ),
                  validator: (value) =>
                      value?.trim().isNotEmpty == true ? null : 'Required',
                ),
              ),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                FilledButton(
                  onPressed: () {
                    if (formKey.currentState!.validate()) {
                      Navigator.pop(
                        context,
                        controllers.map(
                          (key, value) => MapEntry(key, value.text.trim()),
                        ),
                      );
                    }
                  },
                  child: const Text('Save'),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    // The closing dialog animation still uses its text fields.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    for (final controller in controllers.values) {
      controller.dispose();
    }

    return result;
  }

  Future<bool> _confirm(String title) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Confirm'),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _edit() async {
    if (!_detailsForm.currentState!.validate()) return;

    await _perform(() async {
      await _api.request('PATCH', _path, {'name': _name.text.trim()});
      await widget.onChanged();
    });
  }

  Future<void> _environment([Map<String, dynamic>? environment]) async {
    final data = await _form(
      environment == null ? 'New environment' : 'Edit environment',
      {
        'Name': environment?['name'] as String? ?? '',
        'Base URL': environment?['baseUrl'] as String? ?? '',
      },
    );

    if (data == null || !mounted) return;

    await _perform(() async {
      await _api.request(
        environment == null ? 'POST' : 'PATCH',
        '$_path/environments${environment == null ? '' : '/${environment['id']}'}',
        {'name': data['Name'], 'baseUrl': data['Base URL']},
      );
      await _load();
    });
  }

  Future<void> _invite() async {
    final data = await _form('Invite member', {'E-mail': ''});

    if (data == null || !mounted) return;

    await _perform(() async {
      await _api.request('POST', '$_path/invitations', {
        'email': data['E-mail'],
      });
      await _load();
    });
  }

  Future<void> _editMember(Map<String, dynamic> member) async {
    var role = member['role'] as String;
    final action = await showWorkspaceSidePanel<String>(
      context: context,
      title: member['username'] as String,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<String>(
              initialValue: role,
              decoration: const InputDecoration(labelText: 'Role'),
              items: const [
                DropdownMenuItem(value: 'member', child: Text('Member')),
                DropdownMenuItem(value: 'admin', child: Text('Admin')),
              ],
              onChanged: (value) => update(() => role = value!),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: () => Navigator.pop(context, 'save'),
              child: const Text('Save changes'),
            ),
            const SizedBox(height: 40),
            const Divider(),
            const SizedBox(height: 24),
            const Text('Remove their access to this workspace.'),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => Navigator.pop(context, 'remove'),
              child: const Text(
                'Remove member',
                style: TextStyle(color: RelayTokens.error),
              ),
            ),
          ],
        ),
      ),
    );

    if (action == null || !mounted) return;

    if (action == 'remove') {
      await _remove(
        '$_path/members/${member['userId']}',
        'Remove this member?',
        refreshWorkspace: true,
      );
    } else {
      await _perform(() async {
        await _api.request('PATCH', '$_path/members/${member['userId']}', {
          'role': role,
        });
        await widget.onChanged();
        if (mounted) await _load();
      });
    }
  }

  Future<void> _remove(
    String path,
    String question, {
    bool refreshWorkspace = false,
  }) async {
    if (!await _confirm(question) || !mounted) return;

    await _perform(() async {
      await _api.request('DELETE', path);
      if (refreshWorkspace) {
        await widget.onChanged();
      } else {
        await _load();
      }
    });
  }

  Widget _heading(String text) => Padding(
    padding: const EdgeInsets.only(top: 24, bottom: 12),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );

  Widget _settingRow(String title, Widget control) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 20),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final label = Text(
          title,
          style: Theme.of(context).textTheme.titleSmall,
        );

        if (constraints.maxWidth < 650) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [label, const SizedBox(height: 16), control],
          );
        }

        return Row(
          children: [
            Expanded(child: label),
            const SizedBox(width: 24),
            SizedBox(width: 400, child: control),
          ],
        );
      },
    ),
  );

  Widget _generalTab() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _heading('Workspace details'),
      const Text(
        'Manage your workspace’s name and image.',
        style: TextStyle(color: RelayTokens.muted, fontSize: 13),
      ),
      const SizedBox(height: 12),
      if (!_admin) ...[
        Row(
          children: [
            WorkspaceAvatar(
              name: widget.workspace!['name'] as String,
              url: widget.workspace!['avatarUrl'] as String?,
              sessions: widget.sessions,
              size: 48,
            ),
            const SizedBox(width: 16),
            Expanded(child: Text(widget.workspace!['name'] as String)),
          ],
        ),
        const SizedBox(height: 16),
        const Text('Workspace details can be changed by an admin.'),
      ],
      if (_admin) ...[
        _settingRow(
          'Workspace image',
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              WorkspaceImageField(
                key: ValueKey(widget.workspace!['avatarUrl']),
                sessions: widget.sessions,
                name: widget.workspace!['name'] as String,
                url: widget.workspace!['avatarUrl'] as String?,
                onChanged: (image) {
                  if (image == null) return;

                  _perform(() async {
                    await _api.uploadAvatar(
                      widget.workspace!['id'] as String,
                      image.bytes,
                      image.contentType,
                    );
                    await widget.onChanged();
                  });
                },
              ),
              if (widget.workspace!['avatarUrl'] != null)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _perform(() async {
                          await _api.request('DELETE', '$_path/avatar');
                          await widget.onChanged();
                        }),
                  child: const Text('Remove image'),
                ),
            ],
          ),
        ),
        const Divider(height: 1),
        Form(
          key: _detailsForm,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _settingRow(
                'Workspace name',
                TextFormField(
                  controller: _name,
                  maxLength: 100,
                  decoration: const InputDecoration(
                    counterText: '',
                    hintText: 'Workspace name',
                  ),
                  validator: (value) =>
                      value?.trim().isNotEmpty == true ? null : 'Required',
                ),
              ),
              const Divider(height: 1),
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: _busy ? null : _edit,
                  child: const Text('Save changes'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 40),
        const Divider(),
        _heading('Delete workspace'),
        const Text(
          'Remove access to this workspace. Previous runs are retained.',
          style: TextStyle(color: RelayTokens.muted, fontSize: 13),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: _busy
              ? null
              : () => _remove(
                  _path,
                  'Delete workspace? Existing history will be retained.',
                  refreshWorkspace: true,
                ),
          child: const Text(
            'Delete workspace',
            style: TextStyle(color: RelayTokens.error),
          ),
        ),
      ],
    ],
  );

  Widget _membersTab() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Expanded(child: _heading('Members')),
          if (_admin)
            FilledButton(
              onPressed: _busy ? null : _invite,
              child: const Text('Invite member'),
            ),
        ],
      ),
      Container(
        decoration: BoxDecoration(
          border: Border.all(color: RelayTokens.border),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            for (final member in _members)
              ListTile(
                leading: CircleAvatar(
                  backgroundColor: RelayTokens.primaryHover,
                  child: Text(
                    (member['username'] as String)
                        .substring(0, 1)
                        .toUpperCase(),
                  ),
                ),
                title: Text(member['username'] as String),
                subtitle: Text(
                  member['isOwner'] == true
                      ? 'Owner'
                      : member['role'] == 'admin'
                      ? 'Admin'
                      : 'Member',
                ),
                trailing: _admin && member['isOwner'] != true
                    ? OutlinedButton(
                        onPressed: _busy ? null : () => _editMember(member),
                        child: const Text('Edit'),
                      )
                    : null,
              ),
          ],
        ),
      ),
      if (_admin) ...[
        if (_sent.isNotEmpty) _heading('Pending invitations'),
        for (final invitation in _sent)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(invitation['email'] as String),
            trailing: TextButton(
              onPressed: _busy
                  ? null
                  : () => _remove(
                      '$_path/invitations/${invitation['id']}',
                      'Revoke invitation?',
                    ),
              child: const Text('Revoke'),
            ),
          ),
      ],
      const SizedBox(height: 24),
      if (!_owner)
        OutlinedButton(
          onPressed: _busy
              ? null
              : () => _remove(
                  '$_path/members/${widget.sessions.userId}',
                  'Leave this workspace?',
                  refreshWorkspace: true,
                ),
          child: const Text('Leave workspace'),
        ),
    ],
  );

  Widget _environmentsTab() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _heading('Environments'),
                const Text(
                  'Configure the sites that can be tested in this workspace.',
                  style: TextStyle(color: RelayTokens.muted, fontSize: 13),
                ),
              ],
            ),
          ),
          if (_admin)
            Padding(
              padding: const EdgeInsets.only(top: 20, left: 12),
              child: FilledButton(
                onPressed: _busy ? null : () => _environment(),
                child: const Text('New environment'),
              ),
            ),
        ],
      ),
      const SizedBox(height: 20),
      if (_environments.isEmpty) const Text('No environments configured.'),
      for (final environment in _environments)
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(environment['name'] as String),
          subtitle: Text(environment['baseUrl'] as String),
          trailing: _admin
              ? PopupMenuButton<String>(
                  enabled: !_busy,
                  onSelected: (value) {
                    if (value == 'edit') {
                      _environment(environment);
                    } else {
                      _remove(
                        '$_path/environments/${environment['id']}',
                        'Delete environment? Previous runs will be retained.',
                      );
                    }
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('Edit')),
                    PopupMenuItem(value: 'delete', child: Text('Delete')),
                  ],
                )
              : null,
        ),
    ],
  );

  @override
  Widget build(BuildContext context) => DefaultTabController(
    length: 4,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Text(
              _error!,
              style: const TextStyle(color: RelayTokens.error),
            ),
          ),
        TabBar(
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelColor: RelayTokens.text,
          unselectedLabelColor: RelayTokens.muted,
          indicatorColor: RelayTokens.primary,
          indicatorSize: TabBarIndicatorSize.tab,
          indicator: BoxDecoration(
            color: RelayTokens.surface,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: RelayTokens.border),
          ),
          dividerColor: Colors.transparent,
          onTap: (index) => setState(() => _tab = index),
          tabs: const [
            Tab(text: 'General'),
            Tab(text: 'Members'),
            Tab(text: 'Environments'),
            Tab(text: 'GitHub'),
          ],
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          decoration: BoxDecoration(
            color: RelayTokens.surface,
            border: Border.all(color: RelayTokens.border),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_busy) const LinearProgressIndicator(),
              if (widget.workspace != null) ...[
                Offstage(offstage: _tab != 0, child: _generalTab()),
                Offstage(offstage: _tab != 1, child: _membersTab()),
                Offstage(offstage: _tab != 2, child: _environmentsTab()),
                if (_tab == 3)
                  WorkspaceGithubSettings(
                    sessions: widget.sessions,
                    workspaceId: widget.workspace!['id'] as String,
                    admin: _admin,
                  ),
              ],
            ],
          ),
        ),
      ],
    ),
  );
}
