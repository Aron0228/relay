import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:video_player/video_player.dart';
import '../../theme.dart';
import 'execution_api.dart';

class RunMedia extends StatefulWidget {
  const RunMedia({super.key, required this.api, required this.run});
  final ExecutionApi api;
  final TestRun run;

  @override
  State<RunMedia> createState() => _RunMediaState();
}

class _RunMediaState extends State<RunMedia> {
  http.Client? _live;
  VideoPlayerController? _video;
  Uint8List? _frame;
  String? _error;
  int _revision = 0;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(covariant RunMedia oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (oldWidget.run.status != widget.run.status ||
        oldWidget.run.id != widget.run.id ||
        oldWidget.run.hasVideo != widget.run.hasVideo) {
      _start();
    }
  }

  Future<void> _start() async {
    final revision = ++_revision;
    _live?.close();
    await _video?.dispose();
    _video = null;
    _frame = null;
    _error = null;

    if (!mounted || revision != _revision) return;

    if (widget.run.status == 'running') {
      final client = http.Client();
      _live = client;

      try {
        final request = http.Request(
          'GET',
          widget.api.url('/${widget.run.id}/media/stream'),
        );
        request.headers.addAll(widget.api.sessions.authorizationHeaders);
        final response = await client.send(request);

        if (response.statusCode != 200) throw Exception('Preview unavailable');

        var buffer = <int>[];

        await for (final chunk in response.stream) {
          if (!mounted || revision != _revision) break;

          buffer.addAll(chunk);
          var start = _marker(buffer, 0xff, 0xd8);
          var end = start < 0 ? -1 : _marker(buffer, 0xff, 0xd9, start + 2);

          while (start >= 0 && end >= 0) {
            final frame = Uint8List.fromList(buffer.sublist(start, end + 2));
            buffer = buffer.sublist(end + 2);
            setState(() => _frame = frame);
            start = _marker(buffer, 0xff, 0xd8);
            end = start < 0 ? -1 : _marker(buffer, 0xff, 0xd9, start + 2);
          }

          if (buffer.length > 4 * 1024 * 1024) {
            throw Exception('Preview frame too large');
          }
        }
      } catch (_) {
        if (mounted && revision == _revision) {
          setState(() => _error = 'Live preview unavailable');
        }
      }
    } else if (widget.run.hasVideo) {
      final controller = VideoPlayerController.networkUrl(
        widget.api.url('/${widget.run.id}/media/video'),
        httpHeaders: widget.api.sessions.authorizationHeaders,
      );
      _video = controller;

      try {
        await controller.initialize();

        if (mounted && revision == _revision) setState(() {});
      } catch (_) {
        if (mounted && revision == _revision) {
          setState(
            () => _error = 'Could not load the recording. Please try again.',
          );
        }
      }
    }
  }

  int _marker(List<int> data, int first, int second, [int offset = 0]) {
    for (var i = offset; i < data.length - 1; i++) {
      if (data[i] == first && data[i + 1] == second) return i;
    }

    return -1;
  }

  @override
  void dispose() {
    _revision++;
    _live?.close();
    _video?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(12),
    child: ColoredBox(
      color: Colors.black,
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: _error != null
            ? Center(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: RelayTokens.muted),
                  ),
                ),
              )
            : _frame != null
            ? Image.memory(_frame!, gaplessPlayback: true, fit: BoxFit.contain)
            : _video?.value.isInitialized == true
            ? Stack(
                alignment: Alignment.bottomCenter,
                children: [
                  VideoPlayer(_video!),
                  VideoProgressIndicator(_video!, allowScrubbing: true),
                  Center(
                    child: IconButton(
                      tooltip: _video!.value.isPlaying
                          ? 'Pause recording'
                          : 'Play recording',
                      onPressed: () {
                        setState(() {
                          _video!.value.isPlaying
                              ? _video!.pause()
                              : _video!.play();
                        });
                      },
                      icon: Icon(
                        _video!.value.isPlaying
                            ? LucideIcons.pause
                            : LucideIcons.play,
                      ),
                    ),
                  ),
                ],
              )
            : Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(LucideIcons.monitor, color: RelayTokens.muted),
                    const SizedBox(height: 12),
                    Text(
                      widget.run.status == 'queued'
                          ? 'Waiting for a worker'
                          : widget.run.status == 'running'
                          ? 'Connecting to browser…'
                          : 'No recording available',
                      style: const TextStyle(
                        color: RelayTokens.muted,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
      ),
    ),
  );
}
