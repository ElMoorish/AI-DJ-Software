"""
scrape_youtube.py — Scrapes audio from YouTube to build EDM training datasets.

Uses `yt-dlp` to download audio from individual videos, playlists, or search queries
and saves them directly as MP3s into the specified specialist genre folder.

Prerequisites:
    pip install yt-dlp
    FFmpeg must be installed on your system (for audio extraction/conversion).

Usage:
    # 1. Download a playlist into the 'deep_house' folder
    python ml-sidecar/scrape_youtube.py --genre-path data/edm/house/deep_house --url "https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID"

    # 2. Download top 50 search results for "Classic Disco tracks" into the 'classic_disco' folder
    python ml-sidecar/scrape_youtube.py --genre-path data/edm/disco/classic_disco --search "classic disco mix track" --max-downloads 50

    # 3. Download a specific video
    python ml-sidecar/scrape_youtube.py --genre-path data/edm/techno/peak_time --url "https://www.youtube.com/watch?v=VIDEO_ID"
"""
import os
import sys
import argparse
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def check_dependencies():
    """Verify yt-dlp is installed."""
    try:
        import yt_dlp
    except ImportError:
        print("Error: yt-dlp is not installed.")
        print("Please run: pip install yt-dlp")
        sys.exit(1)

def download_audio(target_dir, url=None, search_query=None, max_downloads=50):
    import yt_dlp

    # Ensure target directory exists
    os.makedirs(target_dir, exist_ok=True)
    
    print(f"Target directory: {target_dir}")

    # yt-dlp configuration options
    ydl_opts = {
        'format': 'm4a/bestaudio/best', # Official recommendation: prioritize audio formats but allow fallback
        'outtmpl': os.path.join(target_dir, '%(title)s.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'extract_audio': True,
        'audio_format': 'mp3',
        'noplaylist': False,     # Allow downloading playlists
        'ignoreerrors': True,    # Skip unavailable / premium / geo-blocked videos silently
        'quiet': False,
        'no_warnings': True,
        'retries': 3,            # Retry transient network failures
        'cookiefile': os.path.join(SCRIPT_DIR, 'youtube_cookies.txt'), # Use manually provided cookies
        'extractor_args': {
            'youtube': {
                'player_client': ['android', 'web'],
                'skip': ['hls', 'dash'],  # Skip adaptive manifests that block Premium-only tracks
            }
        },
    }

    # If it's a search query, format the string for yt-dlp's search functionality
    if search_query:
        print(f"Searching YouTube for: '{search_query}' (max {max_downloads} videos)...")
        # ytsearch<N>:query tells yt-dlp to search and download top N results
        download_target = f"ytsearch{max_downloads}:{search_query}"
    elif url:
        print(f"Downloading from URL: {url}")
        download_target = url
    else:
        print("Error: You must provide either a --url or a --search query.")
        sys.exit(1)

    # Note: If it's a playlist URL, max_downloads via ytsearch doesn't apply directly 
    # the same way, but we can limit playlist items.
    if url and 'playlist' in url.lower():
        ydl_opts['playlistend'] = max_downloads

    print("-" * 60)
    print("Starting download process... (This may take a while depending on quality and quantity)")
    print("-" * 60)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            error_code = ydl.download([download_target])
            
        print("-" * 60)
        if error_code == 0:
            print(f"✅ Downloads completed successfully!")
            print(f"Files saved to: {target_dir}")
        else:
            print(f"⚠️ Finished with some errors (code {error_code}). Check output above.")
    except Exception as e:
        print(f"❌ An error occurred during download: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape YouTube audio for EDM training datasets.")
    parser.add_argument("--genre-path", type=str, required=True, 
                        help="Relative path to the genre folder (e.g., data/edm/house/deep_house)")
    parser.add_argument("--url", type=str, 
                        help="YouTube URL (single video or playlist)")
    parser.add_argument("--search", type=str, 
                        help="Text query to search and download on YouTube")
    parser.add_argument("--max-downloads", type=int, default=50, 
                        help="Max videos to download from a playlist or search (default: 50)")
                        
    args = parser.parse_args()
    
    abs_target_dir = os.path.abspath(os.path.join(SCRIPT_DIR, args.genre_path))
    
    check_dependencies()
    download_audio(abs_target_dir, url=args.url, search_query=args.search, max_downloads=args.max_downloads)
