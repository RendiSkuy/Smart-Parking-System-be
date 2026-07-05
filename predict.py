import sys
import joblib
import pandas as pd
import warnings

# Suppress warnings to prevent polluting stdout
warnings.filterwarnings("ignore")

def main():
    if len(sys.argv) < 4:
        print("Error: Missing arguments. Usage: python predict.py <Hour> <DayOfWeek> <Section>", file=sys.stderr)
        sys.exit(1)

    try:
        hour = int(sys.argv[1])
        day_of_week = int(sys.argv[2])
        section_raw = sys.argv[3]

        # Convert section (e.g. 'A', 'B') to numeric index
        # 'A' -> 0, 'B' -> 1, 'C' -> 2
        if section_raw.isdigit():
            section_num = int(section_raw)
        else:
            section_num = ord(section_raw.upper()[0]) - ord('A')

        # Load the machine learning model
        # Using relative path because Python will be executed inside the '/be' folder
        model = joblib.load('smart_parking_model_final.pkl')

        # Format input dataframe with exact feature names expected by the model
        input_data = pd.DataFrame([{
            'Hour': hour,
            'DayOfWeek': day_of_week,
            'Parking_Lot_Section': section_num
        }])

        # Perform prediction
        prediction = model.predict(input_data)[0]

        # Print raw result (0 or 1) to stdout
        print(int(prediction))

    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
