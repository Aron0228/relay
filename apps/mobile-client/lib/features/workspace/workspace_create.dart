import 'dart:typed_data';
import 'package:flutter/material.dart';
import '../../session_service.dart';
import 'workspace_api.dart';
import 'workspace_image_field.dart';
import 'workspace_frame.dart';
import '../../theme.dart';

class WorkspaceCreate extends StatefulWidget {
  const WorkspaceCreate({super.key, required this.sessions});
  final SessionService sessions;

  @override
  State<WorkspaceCreate> createState() => _WorkspaceCreateState();
}

class _WorkspaceCreateState extends State<WorkspaceCreate> {
  late final _api = WorkspaceApi(widget.sessions);
  final _name = TextEditingController();
  ({Uint8List bytes, String contentType})? _image;
  String? _createdId;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _api.close();
    _name.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (_name.text.trim().isEmpty || _busy) return;

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      if (_createdId == null) {
        final workspace = await _api.request('POST', '/workspaces', {
          'name': _name.text.trim(),
        });
        _createdId = workspace['id'] as String;
      }

      if (_image != null) {
        await _api.uploadAvatar(
          _createdId!,
          _image!.bytes,
          _image!.contentType,
        );
      }
      if (mounted) Navigator.pop(context, _createdId);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = _createdId == null
              ? 'Could not create the workspace. Please try again.'
              : 'Workspace created, but the image could not be uploaded. Retry or continue without it.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => WorkspaceFrame(
    onBack: () => Navigator.pop(context),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Create workspace',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w500,
                  letterSpacing: -.5,
                ),
              ),
              SizedBox(height: 10),
              Text(
                'Add a name and an image. Members and environments can be added in settings.',
                style: TextStyle(color: RelayTokens.muted, height: 1.6),
              ),
            ],
          ),
        ),
        const SizedBox(height: 36),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: RelayTokens.surface,
            border: Border.all(color: RelayTokens.border),
            borderRadius: BorderRadius.circular(12),
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final controls = Row(
                children: [
                  WorkspaceImageField(
                    compact: true,
                    sessions: widget.sessions,
                    name: _name.text,
                    onChanged: (image) => _image = image,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: _name,
                      enabled: !_busy && _createdId == null,
                      maxLength: 100,
                      decoration: const InputDecoration(
                        labelText: 'Workspace name',
                        hintText: 'e.g. Engineering',
                        counterText: '',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                ],
              );

              return constraints.maxWidth > 540
                  ? Row(
                      children: [
                        const Expanded(child: Text('Icon & name')),
                        SizedBox(width: 320, child: controls),
                      ],
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Icon & name'),
                        const SizedBox(height: 16),
                        controls,
                      ],
                    );
            },
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 20),
            child: Text(
              _error!,
              style: const TextStyle(color: RelayTokens.error),
            ),
          ),
        const SizedBox(height: 28),
        Align(
          alignment: Alignment.centerRight,
          child: FilledButton(
            onPressed: _busy || _name.text.trim().isEmpty ? null : _create,
            child: Text(
              _busy
                  ? 'Saving…'
                  : _createdId == null
                  ? 'Create workspace'
                  : 'Retry image upload',
            ),
          ),
        ),
        if (_createdId != null && !_busy)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => Navigator.pop(context, _createdId),
              child: const Text('Continue without image'),
            ),
          ),
      ],
    ),
  );
}
