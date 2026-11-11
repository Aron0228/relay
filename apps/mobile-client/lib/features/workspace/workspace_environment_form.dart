import '../../widgets/app_dropdown.dart';
import 'package:flutter/material.dart';
import '../../theme.dart';
import 'workspace_api.dart';

class WorkspaceEnvironmentForm extends StatefulWidget {
  const WorkspaceEnvironmentForm({
    super.key,
    required this.api,
    required this.workspacePath,
    required this.repositories,
    this.environment,
  });
  final WorkspaceApi api;
  final String workspacePath;
  final List<Map<String, dynamic>> repositories;
  final Map<String, dynamic>? environment;

  @override
  State<WorkspaceEnvironmentForm> createState() =>
      _WorkspaceEnvironmentFormState();
}

class _WorkspaceEnvironmentFormState extends State<WorkspaceEnvironmentForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(
    text: widget.environment?['name'] as String? ?? '',
  );
  late final _url = TextEditingController(
    text: widget.environment?['baseUrl'] as String? ?? '',
  );
  late final _origins = TextEditingController(
    text: (widget.environment?['allowedOrigins'] as List? ?? []).join('\n'),
  );
  late String _repositoryId =
      widget.environment?['repositoryId'] as String? ?? '';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _url.dispose();
    _origins.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final id = widget.environment?['id'];
      await widget.api.request(
        id == null ? 'POST' : 'PATCH',
        '${widget.workspacePath}/environments${id == null ? '' : '/$id'}',
        {
          'name': _name.text.trim(),
          'baseUrl': _url.text.trim().isEmpty ? null : _url.text.trim(),
          'repositoryId': _repositoryId.isEmpty ? null : _repositoryId,
          'allowedOrigins': _origins.text
              .split(RegExp(r'[,\n]'))
              .map((value) => value.trim())
              .where((value) => value.isNotEmpty)
              .toList(),
        },
      );
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = error.toString().replaceFirst('Exception: ', '');
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Form(
    key: _form,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextFormField(
          controller: _name,
          decoration: const InputDecoration(labelText: 'Name'),
          validator: (value) =>
              value?.trim().isNotEmpty == true ? null : 'Required',
        ),
        const SizedBox(height: 24),
        AppDropdown<String>(
          initialValue: _repositoryId,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Repository'),
          items: [
            const DropdownMenuItem(value: '', child: Text('Not assigned')),
            for (final repository in widget.repositories)
              DropdownMenuItem(
                value: repository['id'] as String,
                child: Text(repository['fullName'] as String),
              ),
          ],
          onChanged: _busy
              ? null
              : (value) => setState(() => _repositoryId = value ?? ''),
        ),
        const SizedBox(height: 24),
        TextFormField(
          controller: _url,
          decoration: const InputDecoration(
            labelText: 'Base URL',
            hintText: 'https://example-url.com',
          ),
          keyboardType: TextInputType.url,
        ),
        const SizedBox(height: 8),
        const Text(
          'Required for the default test environment. Leave empty for dynamic PR previews.',
          style: TextStyle(color: RelayTokens.muted, fontSize: 12),
        ),
        const SizedBox(height: 24),
        TextFormField(
          controller: _origins,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Allowed websites',
            hintText: 'https://example-url.com',
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Enter the website addresses allowed for PR tests, one per line. Use https://*.example-url.com to allow all subdomains.',
          style: TextStyle(color: RelayTokens.muted, fontSize: 12),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: Text(
              _error!,
              style: const TextStyle(color: RelayTokens.error),
            ),
          ),
        const SizedBox(height: 24),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save environment'),
          ),
        ),
      ],
    ),
  );
}
