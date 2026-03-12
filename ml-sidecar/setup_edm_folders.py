"""
setup_edm_folders.py — Generates the directory structure for hierarchical EDM training.
"""
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
EDM_DIR = os.path.join(SCRIPT_DIR, "data", "edm")

STRUCTURE = {
    "macro": [
        "House", "Techno", "Trance", "Bass", "Disco", "HipHop", "Pop"
    ],
    "house": [
        "Deep House", "Tech House", "Electro House", "Slap House", 
        "Minimal House", "Progressive House", "Acid House", "Afro House"
    ],
    "techno": [
        "Peak Time", "Melodic Techno", "Minimal Techno", 
        "Hard Techno", "Dub Techno", "Industrial"
    ],
    "bass": [
        "Dubstep", "Drum & Bass", "Trap", "UKG"
    ],
    "trance": [
        "Uplifting Trance", "Psytrance", "Progressive Trance"
    ],
    "disco": [
        "Classic Disco", "Nu-Disco", "Italo Disco"
    ]
}

def create_folders():
    print(f"Creating EDM hierarchical folder structure in:\n{EDM_DIR}\n")
    
    total_folders = 0
    for specialist, subgenres in STRUCTURE.items():
        base_path = os.path.join(EDM_DIR, specialist)
        
        for genre in subgenres:
            # Create safe folder names (lowercase, replace spaces with underscores)
            safe_genre = genre.lower().replace(" ", "_").replace("&", "and")
            folder_path = os.path.join(base_path, safe_genre)
            
            os.makedirs(folder_path, exist_ok=True)
            total_folders += 1
            print(f"  Created: {folder_path}")
            
            # Create a placeholder file so git/users know where to put tracks
            with open(os.path.join(folder_path, "DROP_AUDIO_FILES_HERE.txt"), "w") as f:
                f.write(f"Drop your {genre} .mp3 or .wav files in this folder.\n")
                f.write("Aim for at least 50-100 tracks per folder for good accuracy.\n")
                
    print(f"\n✅ Ready! Created {total_folders} folders across {len(STRUCTURE)} specialists.")
    print("\nNext Steps:")
    print("1. Drop your audio files into the respective folders.")
    print("2. Run the macro model training:")
    print(f"   python ml-sidecar/train_specialist_ast.py --data-dir data/edm/macro --model-name macro_edm")
    print("3. Run the micro model training (e.g., House):")
    print(f"   python ml-sidecar/train_specialist_ast.py --data-dir data/edm/house --model-name house_specialist")

if __name__ == "__main__":
    create_folders()
