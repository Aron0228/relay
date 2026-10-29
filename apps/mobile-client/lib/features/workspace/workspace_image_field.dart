import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../session_service.dart';
import 'workspace_avatar.dart';

class WorkspaceImageField extends StatefulWidget {
  const WorkspaceImageField({
    super.key,
    required this.sessions,
    required this.name,
    required this.onChanged,
    this.url,
    this.compact = false,
  });
  final SessionService sessions;
  final String name;
  final String? url;
  final bool compact;
  final void Function(({Uint8List bytes, String contentType})? image) onChanged;

  @override
  State<WorkspaceImageField> createState() => _WorkspaceImageFieldState();
}

class _WorkspaceImageFieldState extends State<WorkspaceImageField> {
  Uint8List? _bytes;
  String? _error;

  Future<void> _choose() async {
    try {
      final file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 90,
        requestFullMetadata: false,
      );

      if (file == null || !mounted) return;

      final extension = file.name.split('.').last.toLowerCase();
      final contentType =
          file.mimeType ??
          switch (extension) {
            'png' => 'image/png',
            'webp' => 'image/webp',
            'jpg' || 'jpeg' => 'image/jpeg',
            _ => '',
          };

      if (!['image/png', 'image/jpeg', 'image/webp'].contains(contentType) ||
          await file.length() > 5 * 1024 * 1024) {
        throw Exception('Choose a PNG, JPEG or WebP image smaller than 5 MB.');
      }

      final bytes = await file.readAsBytes();

      if (!mounted) return;

      setState(() {
        _bytes = bytes;
        _error = null;
      });
      widget.onChanged((bytes: bytes, contentType: contentType));
    } catch (error) {
      if (mounted) {
        if (widget.compact) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(error.toString().replaceFirst('Exception: ', '')),
            ),
          );
        }
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.compact) {
      return Semantics(
        label: 'Choose workspace image',
        button: true,
        child: InkWell(
          onTap: _choose,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(8),
            ),
            child: _bytes == null
                ? WorkspaceAvatar(
                    name: widget.name,
                    url: widget.url,
                    sessions: widget.sessions,
                    size: 38,
                  )
                : ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.memory(_bytes!, fit: BoxFit.cover),
                  ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Semantics(
              label: 'Choose workspace image',
              button: true,
              child: InkWell(
                onTap: _choose,
                borderRadius: BorderRadius.circular(14),
                child: Container(
                  width: 88,
                  height: 88,
                  decoration: BoxDecoration(
                    border: Border.all(color: Theme.of(context).dividerColor),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: _bytes == null
                      ? WorkspaceAvatar(
                          name: widget.name,
                          url: widget.url,
                          sessions: widget.sessions,
                          size: 86,
                        )
                      : ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: Image.memory(_bytes!, fit: BoxFit.cover),
                        ),
                ),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextButton.icon(
                    onPressed: _choose,
                    icon: const Icon(LucideIcons.imagePlus, size: 18),
                    label: const Text('Choose image'),
                  ),
                  const Text(
                    'PNG, JPEG or WebP. Up to 5 MB.',
                    style: TextStyle(fontSize: 12),
                  ),
                  if (_bytes != null)
                    TextButton(
                      onPressed: () {
                        setState(() => _bytes = null);
                        widget.onChanged(null);
                      },
                      child: const Text('Clear selection'),
                    ),
                ],
              ),
            ),
          ],
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
      ],
    );
  }
}
