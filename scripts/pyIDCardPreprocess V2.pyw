import PySimpleGUI as sg
import datetime
import pandas as pd
import cv2
import os
import dlib

# Improved Image Processing Function
def process_images_in_folder(image_folder, adaptive_radius_percentage=70):
    print("Processing images")
    try:
        # Load the face detecQQtion model using dlib
        face_detector = dlib.get_frontal_face_detector()

        # Loop through all files in the folder
        for filename in os.listdir(image_folder):
            if filename.endswith(('.jpg', '.jpeg', '.png')):  # Check if the file is an image
                # Construct the full file path
                file_path = os.path.join(image_folder, filename)
                print(f"Processing file: {file_path}")

                # Load the image
                image = cv2.imread(file_path)
                if image is None:
                    print(f"Error: Unable to read image file {filename}")
                    continue

                # Convert image to grayscale for face detection
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

                # Detect faces using dlib
                faces = face_detector(gray)

                if len(faces) == 0:
                    print(f"No face detected in {filename}.")
                    continue

                # Select the largest detected face (if multiple faces are detected)
                largest_face = max(faces, key=lambda rect: rect.width() * rect.height())
                x, y, w, h = largest_face.left(), largest_face.top(), largest_face.width(), largest_face.height()

                # Calculate the adaptive radius based on the face size
                radius = int(min(w, h) * adaptive_radius_percentage / 100)

                # Adjust coordinates to include more area above the face
                top_padding = radius * 1.5  # Increase padding above the face
                bottom_padding = radius * 0.5  # Slight padding below the face

                # Calculate the coordinates for cropping
                x -= radius
                y -= int(top_padding)
                w += 2 * radius
                h += int(top_padding + bottom_padding)

                # Ensure the cropping coordinates stay within the image boundaries
                x = max(0, x)
                y = max(0, y)
                w = min(image.shape[1] - x, w)
                h = min(image.shape[0] - y, h)

                # Crop the image with the adjusted coordinates
                cropped_face = image[y:y+h, x:x+w]

                # Resize the cropped face to 250x250 pixels
                resized_cropped_face = cv2.resize(cropped_face, (400, 400))

                # Split the input file name and extract the employee ID part
                file_name, file_extension = os.path.splitext(filename)
                parts = file_name.split(' - ')
                if len(parts) == 2:
                    employee_id = parts[0]  # Remove 'MTI' prefix
                    output_file_name = f'{employee_id}.jpg'
                else:
                    output_file_name = f'{file_name}.jpg'

                # Construct the output file path
                output_file_path = os.path.join(image_folder, output_file_name)
                print(f"Saving cropped file: {output_file_path}")

                # Save the resized and cropped face
                if not cv2.imwrite(output_file_path, resized_cropped_face):
                    print(f"Error: Unable to save the output file {output_file_name}")

                # Delete the original image file if output_file_path is different
                if file_path != output_file_path:
                    os.remove(file_path)

    except Exception as e:
        print(f"An error occurred: {str(e)}")


# Improved Excel to CSV Processing Function
def process_excel_to_csv(input_file, output_file):
    try:
        # Read the input Excel file
        df = pd.read_excel(input_file)

        # Create a new DataFrame with the desired column names
        new_df = pd.DataFrame(columns=[
            'Card No #[Max 10]',
            'Card Name [Max 50]',
            'Staff No [Max 15]',
            'Department [Max 50]',
            'Access Level [Max 3]',
            'Company [Max 50]',
            'NRIC/Pass [Max 50]',
            'Remark  [Max 100]',
            'Email [Max 50]',
            'Status [True/False]',
            'Lift Access Level [Max 3]',
            'Vehicle No [Max 15]',
            'ExpiryDate dd/MM/yyyy HH:mm:ss  [Blank for non expired card]',
            'Address [Max 50]',
            'Unit No [Max 15]',
            'Emergency Card [True/False]',
            'Face Access Level [Max 3]'
        ])

        # Extract and transform data for each row in the Excel file
        for index, row in df.iterrows():
            new_row = {
                'Card No #[Max 10]': '',
                'Card Name [Max 50]': row['Name'],
                'Staff No [Max 15]': row['Emp. No'],
                'Department [Max 50]': row['Department'],
                'Access Level [Max 3]': 4 if 'senior' in row['MessHall'].lower() else 2 if 'junior' in row['MessHall'].lower() else 13,
                'Company [Max 50]': 'Merdeka Tsingsan Indonesia',
                'NRIC/Pass [Max 50]': '',
                'Remark  [Max 100]': '',
                'Email [Max 50]': '',
                'Status [True/False]': 'TRUE',
                'Lift Access Level [Max 3]': '',
                'Vehicle No [Max 15]': 'Senior Messhall' if 'senior' in row['MessHall'].lower() else 'Junior Messhall' if 'junior' in row['MessHall'].lower() else 'No Access!!',
                'ExpiryDate dd/MM/yyyy HH:mm:ss  [Blank for non expired card]': '',
                'Address [Max 50]': '',
                'Unit No [Max 15]': '',
                'Emergency Card [True/False]': '',
                'Face Access Level [Max 3]': ''
            }
            new_df = new_df._append(new_row, ignore_index=True)

        # Save the result to a CSV file
        new_df.to_csv(output_file, index=False)
        print(f"CSV file saved to {output_file}")
    except Exception as e:
        print(f"An error occurred while processing Excel to CSV: {str(e)}")

# Improved Excel File Combination Function
def combine_excel_files_in_folder(input_folder, expected_columns, output_file):
    try:
        combined_df = pd.DataFrame()
        
        for filename in os.listdir(input_folder):
            if filename.endswith(('.xls', '.xlsx')):  # Accept both .xls and .xlsx files
                file_path = os.path.join(input_folder, filename)
                df = pd.read_excel(file_path)
                
                # Check if the dataframe has the expected columns
                if all(col in df.columns for col in expected_columns):
                    combined_df = pd.concat([combined_df, df], ignore_index=True)
                else:
                    print(f"Skipping file '{filename}' as it does not match the expected columns format.")

        # Save the combined data to the output Excel file
        combined_df.to_excel(output_file, index=False)
        print(f"Combined Excel file saved to {output_file}")
    except Exception as e:
        print(f"An error occurred while combining Excel files: {str(e)}")

# GUI and Main Function
def main():
    # Get the current date and time
    current_datetime = datetime.datetime.now()
    formatted_datetime = current_datetime.strftime('%d-%m-%Y')
    sg.theme('SystemDefaultForReal')  # Use the system's default theme

    layout = [
        [sg.Text('Select the input folder containing Excel files:')],
        [sg.InputText(key='input_folder'), sg.FolderBrowse()],
        [sg.Text('Select the input folder containing images:')],
        [sg.InputText(key='image_folder'), sg.FolderBrowse()],
        [sg.Text('Adjust Face Percentage for Cropping:')],
        [sg.Slider(range=(10, 100), default_value=70, resolution=5, orientation='h', key='adaptive_radius_slider')],
        [sg.Text('Select Processing Options:')],
        [sg.Radio('Process Images Only', 'process_option', default=True, key='process_images_only')],
        [sg.Radio('Process Images and Excel Files', 'process_option', key='process_both')],
        [sg.Button('Process')],
    ]

    window = sg.Window('ID Card Image Converter', layout)

    while True:
        event, values = window.read()

        if event == sg.WIN_CLOSED:
            break
        elif event == 'Process':
            input_folder = values['input_folder']
            image_folder = values['image_folder']
            adaptive_radius_percentage = 100 - values['adaptive_radius_slider']
            process_images_only = values['process_images_only']
            process_both = values['process_both']

            # Validate input folders
            if not image_folder or (process_both and not input_folder):
                sg.popup("Please select the required input folders based on your choice.")
                continue

            if process_images_only:
                # Process images only
                process_images_in_folder(image_folder, adaptive_radius_percentage=adaptive_radius_percentage)
                sg.popup(f'Image processing complete.')
            elif process_both:
                # Combine Excel files
                output_excel_file = os.path.join(input_folder, f'For_Machine_{formatted_datetime}.xlsx')
                combine_excel_files_in_folder(input_folder, expected_columns, output_excel_file)

                # Convert Excel to CSV
                output_csv_file = os.path.join(input_folder, f'CardDatafileformat_{formatted_datetime}.csv')
                process_excel_to_csv(output_excel_file, output_csv_file)

                # Process images
                process_images_in_folder(image_folder, adaptive_radius_percentage=adaptive_radius_percentage)
                sg.popup(f'Processing complete. Combined Excel saved to {output_excel_file}. CSV saved to {output_csv_file}.')

    window.close()

if __name__ == '__main__':
    expected_columns = ['Emp. No', 'Name', 'Department', 'Section', 'Job Title', 'MessHall']
    main()


